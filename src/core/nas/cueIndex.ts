/**
 * CUE 索引：用 SMB 扫一遍共享目录，记住「哪个目录里有 .cue」
 * 之后打开专辑时按目录名匹配，不靠猜路径。
 */

import { getData, saveData } from '@/plugins/storage'
import { smbList, type SmbCreds } from '@/utils/nativeModules/smb'

const KEY = '@mod_cue_index'
const MAX_DIRS = 6000
const MAX_DEPTH = 5

export interface CueEntry {
  /** 所在目录名 */
  dir: string
  /** 相对共享根的路径 */
  rel: string
  /** cue 文件名 */
  cue: string
}

export interface CueIndex {
  at: number
  host: string
  entries: CueEntry[]
}

let index: CueIndex | null = null

const norm = (s: string) => s
  .toLowerCase()
  .replace(/[\s_\-.,·，。、\[\]【】《》<>()（）]/g, '')

export const getCueIndex = () => index

export const loadCueIndex = async(): Promise<CueIndex | null> => {
  if (index) return index
  try {
    const saved = await getData<CueIndex>(KEY)
    if (saved?.entries?.length) index = saved
  } catch {}
  return index
}

export const clearCueIndex = async() => {
  index = null
  await saveData(KEY, {}).catch(() => {})
}

const CONCURRENCY = 12
// 这些目录不用扫（回收站、快照、系统临时目录）
const SKIP_DIR = /^[@#.]|^\$RECYCLE|^\$Recycle|^\$Extend$/i
// 根目录下这些名字不是音乐库，直接跳过（省掉大量无谓列目录）
const SKIP_ROOT = /^(Videos?|Photos?|Pictures?|Movies?|Downloads?|Public|homes?|Web|AppCenter|Multimedia_\.?|Time ?Machine|NASWUGE)$/i

/** 扫共享里的所有 .cue（只记目录，不读内容）：按层并发 */
export const buildCueIndex = async(
  creds: SmbCreds,
  onProgress?: (msg: string) => void,
  shouldAbort?: () => boolean,
): Promise<CueEntry[]> => {
  const entries: CueEntry[] = []
  let level: Array<{ rel: string, depth: number }> = [{ rel: '', depth: 0 }]
  let visited = 0
  const started = Date.now()

  let pending = 1
  const scanOne = async(cur: { rel: string, depth: number }) => {
    let items: Array<{ name: string, dir: boolean }> = []
    try {
      items = await smbList(creds, cur.rel)
    } catch {
      return [] as Array<{ rel: string, depth: number }>
    }
    visited++
    pending = Math.max(0, pending - 1)
    const cue = items.find(i => !i.dir && i.name.toLowerCase().endsWith('.cue'))
    if (cue) {
      entries.push({
        dir: cur.rel.split('/').pop() || cur.rel,
        rel: cur.rel,
        cue: cue.name,
      })
    }
    if (visited % 10 === 0) {
      const sec = Math.max(1, Math.round((Date.now() - started) / 1000))
      const rate = Math.round(visited / sec)
      onProgress?.(`扫描 CUE：${visited} 个目录 / ${sec}s（${rate}/s，还有约 ${pending} 个），找到 ${entries.length} 个`)
    }
    if (cur.depth >= MAX_DEPTH) return [] as Array<{ rel: string, depth: number }>
    const out: Array<{ rel: string, depth: number }> = []
    for (const it of items) {
      if (!it.dir || SKIP_DIR.test(it.name)) continue
      if (cur.rel === '' && SKIP_ROOT.test(it.name)) continue
      out.push({ rel: cur.rel ? `${cur.rel}/${it.name}` : it.name, depth: cur.depth + 1 })
      if (visited + out.length + level.length >= MAX_DIRS) break
    }
    return out
  }

  while (level.length && visited < MAX_DIRS && !shouldAbort?.()) {
    const next: Array<{ rel: string, depth: number }> = []
    for (let i = 0; i < level.length; i += CONCURRENCY) {
      if (shouldAbort?.() || visited >= MAX_DIRS) break
      const chunk = level.slice(i, i + CONCURRENCY)
      const res = await Promise.all(chunk.map(scanOne))
      for (const r of res) next.push(...r)
      pending = next.length + (level.length - i - chunk.length)
    }
    level = next
  }

  index = { at: Date.now(), host: creds.host, entries }
  await saveData(KEY, index).catch(() => {})
  const sec = Math.max(1, Math.round((Date.now() - started) / 1000))
  onProgress?.(`CUE 索引完成：${visited} 个目录 / ${sec}s，${entries.length} 个 cue`)
  return entries
}

/** 按目录名找 cue（先精确，再包含） */
export const findCueForAlbum = (albumTitle: string): CueEntry | null => {
  if (!index?.entries?.length) return null
  const want = norm(albumTitle)
  if (!want) return null
  return index.entries.find(e => norm(e.dir) == want) ??
    index.entries.find(e => norm(e.dir).includes(want) || want.includes(norm(e.dir))) ??
    null
}
