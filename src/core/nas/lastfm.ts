/**
 * Last.fm 艺人资料（官方 API，直连可达，无需代理）
 *   method=artist.getinfo&format=json&lang=zh
 * 返回：简介(中文)、标签、听众数、播放数、艺人图
 */

const API_KEY = '8e14598d2f800f152058e0f4ed2ac5b5'
/** Last.fm 的默认占位图（灰色星标），拿到就当作没有图 */
const PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f'

export interface LastfmArtist {
  name: string
  listeners: number
  playcount: number
  tags: string[]
  bio: string
  image: string | null
}

const stripHtml = (html: string): string => html
  .replace(/<a[^>]*>Read more on Last\.fm<\/a>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const fetchJson = async(url: string, timeoutMs = 8000): Promise<any> => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => { ctrl.abort() }, timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`HTTP ${res.status}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

const cache = new Map<string, LastfmArtist | null>()

export const getLastfmArtist = async(name: string): Promise<LastfmArtist | null> => {
  const key = (name ?? '').trim()
  if (!key) return null
  if (cache.has(key)) return cache.get(key) ?? null

  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(key)}&api_key=${API_KEY}&format=json&lang=zh&autocorrect=1`
    const json = await fetchJson(url)
    const a = json?.artist
    if (!a?.name) {
      cache.set(key, null)
      return null
    }

    const tags: string[] = (a?.tags?.tag ?? [])
      .map((t: any) => String(t?.name ?? '').trim())
      .filter(Boolean)
      .slice(0, 6)

    const images: string[] = (a?.image ?? [])
      .map((i: any) => String(i?.['#text'] ?? ''))
      .filter((u: string) => u && !u.includes(PLACEHOLDER))

    const result: LastfmArtist = {
      name: String(a.name),
      listeners: Number((a?.stats?.listeners ?? 0)) || 0,
      playcount: Number((a?.stats?.playcount ?? 0)) || 0,
      tags,
      bio: stripHtml(String(a?.bio?.summary ?? a?.bio?.content ?? '')),
      image: images.length ? images[images.length - 1] : null,
    }
    cache.set(key, result)
    return result
  } catch {
    cache.set(key, null)
    return null
  }
}
