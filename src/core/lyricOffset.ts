/**
 * 歌词时间轴微调（按歌曲记忆）
 *   - 单位毫秒，正数=歌词提前显示，负数=延后
 *   - 只用于显示，不改歌词文件本身
 */

import { getData, saveData } from '@/plugins/storage'

const KEY = '@mod_lyric_offset'
const MAX_ENTRIES = 800
// 允许 ±60 秒：覆盖前奏过长 / 现场版错位；再大基本是歌词版本不对
const MIN_MS = -60000
const MAX_MS = 60000

let offsets: Record<string, number> = {}
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

export const loadLyricOffsets = async() => {
  if (loaded) return
  loaded = true
  try {
    offsets = (await getData<Record<string, number>>(KEY)) ?? {}
  } catch {
    offsets = {}
  }
}

const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveData(KEY, offsets).catch(() => {})
  }, 500)
}

export const getLyricOffset = (id?: string | null): number => (id ? offsets[id] ?? 0 : 0)

/** 偏移展示：<1 分钟显示秒，≥1 分钟显示 m/s（整分钟省略秒，如 +1m） */
export const formatLyricOffset = (ms: number): string => {
  const sign = ms > 0 ? '+' : ms < 0 ? '-' : ''
  const abs = Math.abs(ms)
  if (abs >= 60000) {
    const m = Math.floor(abs / 60000)
    const s = (abs % 60000) / 1000
    return s === 0 ? `${sign}${m}m` : `${sign}${m}m${s.toFixed(1)}s`
  }
  return `${sign}${(abs / 1000).toFixed(1)}s`
}

/** 累加偏移，返回调整后的值（毫秒） */
export const shiftLyricOffset = (id: string, deltaMs: number): number => {
  const raw = getLyricOffset(id) + deltaMs
  const next = Math.max(MIN_MS, Math.min(MAX_MS, Math.round(raw / 100) * 100))

  if (next) {
    offsets[id] = next
    const keys = Object.keys(offsets)
    if (keys.length > MAX_ENTRIES) {
      keys.slice(0, keys.length - MAX_ENTRIES).forEach(k => { delete offsets[k] })
    }
  } else {
    delete offsets[id]
  }
  scheduleSave()
  return next
}

export const resetLyricOffset = (id: string): number => {
  delete offsets[id]
  scheduleSave()
  return 0
}
