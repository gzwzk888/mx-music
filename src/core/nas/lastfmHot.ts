/**
 * Last.fm 华语热歌榜（tag.gettoptracks）
 * 合并 chinese / c-pop / mandopop / cantopop 四个标签，去重后按听众排序
 */

import { getData, saveData } from '@/plugins/storage'

const API_KEY = '8e14598d2f800f152058e0f4ed2ac5b5'
const TAGS = ['chinese', 'c-pop', 'mandopop', 'cantopop']
const CACHE_KEY = '@mod_lfm_hot'
const CACHE_MS = 6 * 60 * 60 * 1000

export interface HotTrack {
  key: string
  name: string
  artist: string
  listeners: number
  tag: string
}

let hot: HotTrack[] = []
let hotAt = 0
let loading: Promise<HotTrack[]> | null = null

const fetchTag = async(tag: string, limit: number): Promise<HotTrack[]> => {
  const url = `https://ws.audioscrobbler.com/2.0/?method=tag.gettoptracks&tag=${encodeURIComponent(tag)}&limit=${limit}&api_key=${API_KEY}&format=json`
  const res = await fetch(url)
  const json = await res.json()
  const list: any[] = json?.tracks?.track ?? []
  return list.map(t => ({
    key: `${t?.name ?? ''}|${t?.artist?.name ?? ''}`.toLowerCase(),
    name: String(t?.name ?? ''),
    artist: String(t?.artist?.name ?? ''),
    listeners: Number(t?.listeners ?? 0) || 0,
    tag,
  })).filter(t => t.name && t.artist)
}

export const getChineseHotTracks = async(force = false): Promise<HotTrack[]> => {
  if (!force && hot.length && Date.now() - hotAt < CACHE_MS) return hot
  if (loading) return await loading

  loading = (async() => {
    try {
      if (!force && !hot.length) {
        const cached = await getData<{ at: number, list: HotTrack[] }>(CACHE_KEY).catch(() => null)
        if (cached?.list?.length && Date.now() - (cached.at ?? 0) < CACHE_MS) {
          hot = cached.list
          hotAt = cached.at
          return hot
        }
      }
      const results = await Promise.all(TAGS.map(tag => fetchTag(tag, 40).catch(() => [])))
      const map = new Map<string, HotTrack>()
      for (const item of results.flat()) {
        const prev = map.get(item.key)
        if (!prev || item.listeners > prev.listeners) map.set(item.key, item)
      }
      hot = [...map.values()].sort((a, b) => b.listeners - a.listeners).slice(0, 80)
      hotAt = Date.now()
      void saveData(CACHE_KEY, { at: hotAt, list: hot }).catch(() => {})
      return hot
    } finally {
      loading = null
    }
  })()

  return await loading
}

/** 用 iTunes 搜封面（Last.fm 榜单不带图） */
const artCache = new Map<string, string | null>()

export const getItunesArt = async(name: string, artist: string): Promise<string | null> => {
  const key = `${name}|${artist}`.toLowerCase()
  if (artCache.has(key)) return artCache.get(key)!
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${name}`)}&media=music&limit=1`
    const res = await fetch(url)
    const json = await res.json()
    const art = json?.results?.[0]?.artworkUrl100
    const big = art ? String(art).replace('100x100bb', '300x300bb') : null
    artCache.set(key, big)
    return big
  } catch {
    artCache.set(key, null)
    return null
  }
}
