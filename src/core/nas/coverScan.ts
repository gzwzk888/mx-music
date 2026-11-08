/**
 * NAS 封面缓存扫描
 *
 * 逐首：HTTP Range 取内嵌封面（readRemoteArt） → 原生算 SHA-1 + 512px 缩略图落盘。
 * 只认哈希：同一张图（不同目录/不同曲目）只存一份；取不到图就标记没有封面，
 * 这样音乐库/随机100 的「有封面」判定才和真实渲染一致（不会出现占位格）。
 */
import { makeThumbFromBase64, thumbOf } from '@/core/local/coverCache'
import { readRemoteArt } from './embeddedArt'
import { getNasIndex, setNasIndex } from './session'

export interface CoverScanProgress {
  done: number
  total: number
  ok: number
  fail: number
  text: string
}

export interface CoverScanResult {
  total: number
  /** 新生成 / 已有缓存 */
  ok: number
  /** 没有内嵌封面 */
  none: number
  /** 读取失败（网络等） */
  fail: number
  aborted: boolean
  /** 本次新写入的缩略图数量 */
  written: number
  ms: number
}

let running = false
export const isCoverScanning = () => running

const CONCURRENCY = 2

export const scanNasCovers = async(
  onProgress?: (p: CoverScanProgress) => void,
  shouldAbort?: () => boolean,
): Promise<CoverScanResult | null> => {
  const idx = getNasIndex()
  if (!idx?.songs?.length) return null
  if (running) return null
  running = true
  const t0 = Date.now()
  let done = 0
  let ok = 0
  let none = 0
  let fail = 0
  let written = 0
  let aborted = false
  const total = idx.songs.length

  const report = (text?: string) => {
    onProgress?.({
      done, total, ok, fail,
      text: text ?? `封面 ${done}/${total} · 新生成 ${written}`,
    })
  }
  report('开始读取封面…')

  try {
    let cursor = 0
    const worker = async() => {
      while (true) {
        if (shouldAbort?.()) { aborted = true; return }
        const i = cursor++
        if (i >= total) return
        const song = idx.songs[i]
        if (song.coverHash) {
          const hit = await thumbOf(song.coverHash)
          if (hit) { done++; ok++; report(); continue }
        }
        let art: string | null = null
        try {
          art = await readRemoteArt(song.url)
        } catch {
          // 网络/读取失败：不要标记成「没有封面」，留空让下次扫描重试
          fail++
          done++
          report()
          continue
        }
        if (!art) {
          // 确认没有内嵌图（服务器给的 albumArtURI 对普通客户端 404，不用）
          none++
          song.coverHash = ''
          done++
          report()
          continue
        }
        const r = await makeThumbFromBase64(art)
        if (r?.thumb) {
          song.coverHash = r.hash
          if (!r.cached) written++
          ok++
        } else {
          fail++
        }
        done++
        if (done % 50 == 0) {
          // 定期落盘，进程被杀不至于全丢
          setNasIndex(idx)
          report()
        } else {
          report()
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
    setNasIndex(idx)
    report(aborted ? '已取消' : '封面读取完成')
    return { total, ok, none, fail, aborted, written, ms: Date.now() - t0 }
  } finally {
    running = false
  }
}
