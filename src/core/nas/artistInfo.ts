/**
 * 艺人简介：多源兜底
 *   1. 网易云  /api/search/get?type=100 → /api/artist/introduction（分段简介，排版好）
 *   2. 酷狗    mobilecdn…/search/singer → /singer/info（profile 全文 + 头像，中文歌手覆盖更全）
 *   3. 名字搜不到时，用歌名反查真实艺人再试
 */

import { getLastfmArtist } from './lastfm'

export interface ArtistIntroSection {
  title: string
  text: string
}

export interface ArtistIntro {
  name: string
  picUrl?: string | null
  sections: ArtistIntroSection[]
  source: string
  /** Last.fm 标签 */
  tags?: string[]
  /** Last.fm 听众数 */
  listeners?: number
  /** Last.fm 播放次数 */
  playcount?: number
}

export interface ArtistLookup {
  intro: ArtistIntro | null
  /** 尝试过的关键词，便于界面提示 / 排查 */
  tried: string[]
  note?: string
}

const cache = new Map<string, ArtistLookup>()

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'

const fetchText = async(url: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<string> => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => { ctrl.abort() }, timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, ...headers } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

const fetchJson = async(url: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<any> => {
  const text = await fetchText(url, headers, timeoutMs)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('返回不是 JSON')
  }
}

/** 去掉括号内容、多余符号，得到更容易命中的名字 */
const cleanName = (name: string): string => name
  .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const nameCandidates = (raw: string): string[] => {
  const list: string[] = []
  const push = (v: string) => {
    const s = v.trim()
    if (s && !list.includes(s)) list.push(s)
  }
  push(raw)
  push(cleanName(raw))
  const first = raw.split(/[、,/&;；]/)[0]
  push(first)
  push(cleanName(first))
  return list.filter(Boolean).slice(0, 3)
}

/* ---------------- 网易云 ---------------- */

const neteaseSections = async(id: number): Promise<ArtistIntroSection[]> => {
  try {
    const detail = await fetchJson(`https://music.163.com/api/artist/introduction?id=${id}`, {
      Referer: 'https://music.163.com',
      Cookie: 'os=pc; appver=8.9.70',
    })
    const sections = (detail?.introduction ?? [])
      .map((i: any) => ({ title: (i?.ti ?? '').trim(), text: (i?.txt ?? '').trim() }))
      .filter((s: ArtistIntroSection) => s.text)
    if (sections.length) return sections
  } catch {}

  try {
    const artist = await fetchJson(`https://music.163.com/api/artist/${id}`, {
      Referer: 'https://music.163.com',
      Cookie: 'os=pc; appver=8.9.70',
    })
    const brief = (artist?.artist?.briefDesc ?? '').trim()
    if (brief) return [{ title: '', text: brief }]
  } catch {}

  return []
}

const tryNetease = async(keyword: string): Promise<{ intro: ArtistIntro | null, note?: string }> => {
  const json = await fetchJson(`https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=100&limit=5`, {
    Referer: 'https://music.163.com',
    Cookie: 'os=pc; appver=8.9.70',
  })
  const artists: any[] = json?.result?.artists ?? []
  if (!artists.length) return { intro: null, note: '网易云没搜到' }

  const hit = artists.find(a => a?.name === keyword) ?? artists[0]
  if (!hit?.id) return { intro: null, note: '网易云艺人数据异常' }

  const sections = await neteaseSections(hit.id)
  if (!sections.length) return { intro: null, note: `网易云没有 ${hit.name} 的资料` }

  return { intro: { name: hit.name ?? keyword, picUrl: hit.picUrl ?? null, sections, source: '网易云音乐' } }
}

/* ---------------- 酷狗 ---------------- */

const tryKugou = async(keyword: string): Promise<{ intro: ArtistIntro | null, note?: string }> => {
  const search = await fetchJson(`http://mobilecdn.kugou.com/api/v3/search/singer?keyword=${encodeURIComponent(keyword)}&page=1&pagesize=5`, {
    Referer: 'http://m.kugou.com/',
  })
  const list: any[] = Array.isArray(search?.data) ? search.data : []
  if (!list.length) return { intro: null, note: '酷狗没搜到' }

  const hit = list.find(s => s?.singername === keyword) ?? list[0]
  if (!hit?.singerid) return { intro: null, note: '酷狗艺人数据异常' }

  const info = await fetchJson(`http://mobilecdn.kugou.com/api/v3/singer/info?singerid=${hit.singerid}`, {
    Referer: 'http://m.kugou.com/',
  })
  const data = info?.data ?? {}
  const profile = String(data.profile ?? '').trim()
  if (!profile) return { intro: null, note: `酷狗没有 ${data.singername ?? keyword} 的资料` }

  const sections: ArtistIntroSection[] = profile
    .split(/\n{1,}/)
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => ({ title: '', text: t }))

  // imgurl 里带 {size} 占位符
  const rawPic = String(data.imgurl ?? '').replace(/^http:/, 'https:')
  const picUrl = rawPic ? rawPic.replace('{size}', '480') : null

  return {
    intro: {
      name: data.singername ?? keyword,
      picUrl,
      sections,
      source: '酷狗音乐',
    },
  }
}

/* ---------------- 用歌名反查艺人 ---------------- */

const artistBySongTitle = async(title: string): Promise<string> => {
  if (!title) return ''
  try {
    const json = await fetchJson(`https://music.163.com/api/search/get?s=${encodeURIComponent(title)}&type=1&limit=5`, {
      Referer: 'https://music.163.com',
      Cookie: 'os=pc; appver=8.9.70',
    })
    const songs: any[] = json?.result?.songs ?? []
    for (const s of songs) {
      const name = s?.artists?.[0]?.name
      if (name && name !== '群星') return name
    }
  } catch {}
  return ''
}

/**
 * 查艺人简介；singer 可带括号/多艺人，songTitle 用于反查真实艺人
 * 优先级：Last.fm（简介够长）→ 网易云 → 酷狗；标签/听众数恒取 Last.fm
 */
export const getArtistIntro = async(singer: string, songTitle?: string): Promise<ArtistLookup> => {
  const raw = (singer ?? '').trim()
  const cacheKey = `${raw}|${songTitle ?? ''}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)!

  const tried: string[] = []
  const notes: string[] = []
  // 用对象持有：闭包里赋值时 TS 才能正确推断类型
  const found: { netease: ArtistIntro | null, kugou: ArtistIntro | null } = { netease: null, kugou: null }

  // Last.fm 同时开跑，不阻塞其他源
  const lfmPromise = getLastfmArtist(raw).catch(() => null)

  const attempt = async(keyword: string): Promise<boolean> => {
    if (!keyword || tried.includes(keyword)) return false
    tried.push(keyword)
    if (!found.netease) {
      try {
        const { intro, note } = await tryNetease(keyword)
        if (intro) found.netease = intro
        else if (note) notes.push(note)
      } catch (e: any) {
        notes.push(`网易云请求失败：${e?.message ?? e}`)
      }
    }
    if (!found.kugou) {
      try {
        const { intro, note } = await tryKugou(keyword)
        if (intro) found.kugou = intro
        else if (note) notes.push(note)
      } catch (e: any) {
        notes.push(`酷狗请求失败：${e?.message ?? e}`)
      }
    }
    return !!(found.netease || found.kugou)
  }

  for (const keyword of nameCandidates(raw)) {
    await attempt(keyword)
    if (found.netease && found.kugou) break
  }

  let songArtist = ''
  if (!found.netease && !found.kugou && songTitle) {
    songArtist = await artistBySongTitle(songTitle)
    if (songArtist) await attempt(songArtist)
  }

  const lfm = await lfmPromise

  // 选主简介
  let sections: ArtistIntroSection[] = []
  let source = ''
  if (lfm && lfm.bio.length >= 120) {
    sections = lfm.bio
      .split(/\n{2,}/)
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => ({ title: '', text: t }))
    source = 'Last.fm'
  } else if (found.netease) {
    sections = found.netease.sections
    source = found.netease.source
  } else if (found.kugou) {
    sections = found.kugou.sections
    source = found.kugou.source
  } else if (lfm && lfm.bio) {
    sections = lfm.bio.split(/\n{2,}/).map(t => t.trim()).filter(Boolean).map(t => ({ title: '', text: t }))
    source = 'Last.fm'
  }

  const intro: ArtistIntro | null = sections.length
    ? {
        name: found.netease?.name ?? found.kugou?.name ?? lfm?.name ?? raw,
        picUrl: found.netease?.picUrl ?? found.kugou?.picUrl ?? lfm?.image ?? null,
        sections,
        source,
        tags: lfm?.tags?.length ? lfm.tags : undefined,
        listeners: lfm?.listeners || undefined,
        playcount: lfm?.playcount || undefined,
      }
    : null

  const result: ArtistLookup = {
    intro,
    tried,
    note: intro
      ? undefined
      : (raw ? (notes[0] ?? '没找到这位艺人的简介') : '这首歌没有艺人信息'),
  }
  cache.set(cacheKey, result)
  return result
}
