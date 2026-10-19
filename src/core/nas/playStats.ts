/**
 * 播放统计：记录每首歌被播放的次数，用于「最近」按专辑聚合
 */

import { getData, saveData } from '@/plugins/storage'
import playerState from '@/store/player/state'

export interface SongStat {
  id: string
  name: string
  singer: string
  album: string
  picUrl: string | null
  filePath: string
  count: number
  lastAt: number
}

export interface AlbumStat {
  album: string
  singer: string
  count: number
  songs: SongStat[]
  picUrl: string | null
}

const KEY = '@mod_play_stats'
let stats: Record<string, SongStat> = {}
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastId = ''

const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveData(KEY, stats).catch(() => {})
  }, 3000)
}

export const loadPlayStats = async() => {
  if (loaded) return
  loaded = true
  try {
    const saved = await getData<Record<string, SongStat>>(KEY)
    if (saved && typeof saved == 'object') stats = saved
  } catch {}
}

export const recordPlay = (musicInfo: any) => {
  if (!musicInfo?.id) return
  const meta = musicInfo.meta ?? {}
  const prev = stats[musicInfo.id]
  stats[musicInfo.id] = {
    id: musicInfo.id,
    name: musicInfo.name ?? '',
    singer: musicInfo.singer ?? '',
    album: String(meta.albumName ?? '').trim(),
    picUrl: meta.picUrl ?? prev?.picUrl ?? null,
    filePath: String(meta.filePath ?? ''),
    count: (prev?.count ?? 0) + 1,
    lastAt: Date.now(),
  }
  scheduleSave()
}

/** 单曲统计（按播放次数） */
export const getSongStats = (): SongStat[] => Object.values(stats).sort((a, b) => b.count - a.count)

const normKey = (v: string) => v.toLowerCase().replace(/[\s\-_().（）[\]·,，、&/]/g, '')

/**
 * 「最近」：按最后播放时间倒序，按 歌名+歌手 去重，取前 limit 首
 * （同一首歌换了 id/来源也只留最近的那条）
 */
export const getRecentSongStats = (limit = 100): SongStat[] => {
  const list = Object.values(stats).sort((a, b) => b.lastAt - a.lastAt)
  const seen = new Set<string>()
  const out: SongStat[] = []
  for (const s of list) {
    const key = `${normKey(s.name)}|${normKey(s.singer) || s.filePath}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= limit) break
  }
  return out
}

/** 专辑聚合：取最近 recentLimit 首已播，按专辑累计播放次数排序 */
export const getAlbumStats = (recentLimit = 200): AlbumStat[] => {
  const list = Object.values(stats).sort((a, b) => b.lastAt - a.lastAt).slice(0, recentLimit)
  const map = new Map<string, AlbumStat>()
  for (const s of list) {
    const album = s.album || '未知专辑'
    const key = `${album}||${s.singer.split(/[、,/&]/)[0].trim()}`
    const hit = map.get(key) ?? { album, singer: s.singer, count: 0, songs: [], picUrl: null }
    hit.count += s.count
    hit.songs.push(s)
    if (!hit.picUrl && s.picUrl) hit.picUrl = s.picUrl
    map.set(key, hit)
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

export const initPlayStats = async() => {
  await loadPlayStats()
  global.state_event.on('playMusicInfoChanged', () => {
    const mi = playerState.playMusicInfo?.musicInfo
    if (!mi?.id || mi.id === lastId) return
    lastId = mi.id
    recordPlay(mi)
  })
}
