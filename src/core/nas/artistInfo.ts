/**
 * 艺人简介：宁可查不到，也不返回错的人
 *
 * 名字来源优先级（严格按这个顺序，拿不到就停）：
 *   1. 标签里的 singer（`Unknown / 未知 / 群星 / Various Artists` 等占位值一律当作没有）
 *   2. 从文件名提：优先「 - 」「 – 」「 — 」「 _ 」「 | 」这类明确分隔符，其次空格
 *   3. 提不出 → 不搜，直接告诉界面「没有艺人信息」
 *
 * 匹配规则：只接受**名字精确相等**（归一化后）的艺人，绝不取搜索结果第一条凑数。
 * 歌名反查歌手那条路已删除——它会把《月满西楼》指成安雯，属于「返回错误」。
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
  /** 最终用来搜的名字（可能是标签，也可能是从文件名提的） */
  resolvedName: string
  /** 这个名字是哪来的，便于界面/排查 */
  nameSource: 'tag' | 'filename' | 'none'
  /** 尝试过的关键词 */
  tried: string[]
  note?: string
}

const cache = new Map<string, ArtistLookup>()

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'

/** 占位/无效的艺人名：这些不是人，拿去搜必然搜到莫名其妙的歌手 */
const PLACEHOLDER = new Set([
  'unknown', 'unknown artist', 'unknown artists', '未知', '未知艺术家', '未知艺人', '未知歌手',
  'various artists', 'various', 'va', '群星', '合集', '杂锦', '杂辑', '精选', '合辑',
  '原声', '原声带', '影视原声', '纯音乐', '轻音乐', '佚名', '无名', 'n/a', 'na', '-', '—',
])

const normName = (s: string): string => (s ?? '')
  .toLowerCase()
  .replace(/[\s·•・.,，。、'"“”‘’()（）\[\]【】《》<>!！?？:：;；\-–—_/\\]/g, '')

const isPlaceholder = (s: string): boolean => {
  const raw = (s ?? '').trim()
  if (!raw) return true
  const t = raw.toLowerCase().trim()
  if (PLACEHOLDER.has(t)) return true
  if (t.startsWith('unknown')) return true          // unknown / unknown artist / ...
  if (/^(未知|佚名|无名)/.test(t)) return true
  if (/^\d+$/.test(t)) return true                  // 纯数字
  return false
}

/**
 * 从文件名/标题里提艺人：优先「 - / – / — / _ / |」分隔，其次空格
 * 例：`童丽 - 06 月满西楼` → 童丽；`06 月满西楼` → ''（提不出）
 */
export const extractArtistFromName = (name: string): string => {
  let s = (name ?? '').trim()
  if (!s) return ''
  s = s.replace(/\.(wav|flac|ape|dff|dsf|mp3|m4a|wv|ogg|aac)$/i, ' ')
  s = s.replace(/[\[【][^\]】]*[\]】]/g, ' ')        // [WAV] 【HQ】
  s = s.replace(/^\s*\d+\s*[-.、:：]?\s*/, '')      // 开头的 01 / 01- / 01.
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return ''

  const ok = (a: string): boolean => {
    const v = a.trim()
    if (v.length < 2 || v.length > 14) return false
    if (isPlaceholder(v)) return false
    if (/^\d+$/.test(v)) return false
    return true
  }

  // 1) 明确分隔符（两侧允许有空格，也允许只在一侧）
  const sep = s.match(/^(.+?)\s*[-–—_|]\s*(.+)$/)
  if (sep) {
    const a = sep[1].trim()
    if (ok(a)) return a
  }

  // 2) 空格分隔：第一段当艺人（用户指定「优先空格」）
  const sp = s.match(/^(\S{2,10})\s+(\S.*)$/)
  if (sp) {
    const a = sp[1].trim()
    // 空格分隔误判率高，额外要求第一段不像歌名片段（不含书名号/引号）
    if (ok(a) && !/[《》「」“”"]/.test(a)) return a
  }
  return ''
}

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
  const json = await fetchJson(`https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=100&limit=10`, {
    Referer: 'https://music.163.com',
    Cookie: 'os=pc; appver=8.9.70',
  })
  const artists: any[] = json?.result?.artists ?? []
  if (!artists.length) return { intro: null, note: '网易云没搜到' }

  // 只要精确同名，绝不取第一条
  const want = normName(keyword)
  const hit = artists.find(a => normName(String(a?.name ?? '')) === want)
  if (!hit?.id) return { intro: null, note: `网易云没有精确匹配「${keyword}」的艺人` }

  const sections = await neteaseSections(hit.id)
  if (!sections.length) return { intro: null, note: `网易云没有 ${hit.name} 的资料` }

  return { intro: { name: hit.name ?? keyword, picUrl: hit.picUrl ?? null, sections, source: '网易云音乐' } }
}

/* ---------------- 酷狗 ---------------- */

const tryKugou = async(keyword: string): Promise<{ intro: ArtistIntro | null, note?: string }> => {
  const search = await fetchJson(`http://mobilecdn.kugou.com/api/v3/search/singer?keyword=${encodeURIComponent(keyword)}&page=1&pagesize=10`, {
    Referer: 'http://m.kugou.com/',
  })
  const list: any[] = Array.isArray(search?.data) ? search.data : []
  if (!list.length) return { intro: null, note: '酷狗没搜到' }

  const want = normName(keyword)
  const hit = list.find(s => normName(String(s?.singername ?? '')) === want)
  if (!hit?.singerid) return { intro: null, note: `酷狗没有精确匹配「${keyword}」的艺人` }

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

/**
 * 查艺人简介。名字只从「标签」或「文件名」来，取不到就返回空，不猜。
 * @param singer 标签里的艺人（可能为空或 Unknown）
 * @param name   曲目名/文件名（用于提取，如「童丽 - 06 月满西楼」）
 */
export const getArtistIntro = async(singer: string, name?: string): Promise<ArtistLookup> => {
  const rawSinger = (singer ?? '').trim()
  const rawName = (name ?? '').trim()
  const cacheKey = `${rawSinger}|${rawName}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)!

  // ---- 1) 定名 ----
  let artistName = ''
  let nameSource: ArtistLookup['nameSource'] = 'none'
  if (rawSinger && !isPlaceholder(rawSinger)) {
    artistName = rawSinger
    nameSource = 'tag'
  } else {
    // 标签里的名字可能是「童丽 (合唱版)」，去括号再判断一次
    const cleaned = rawSinger.replace(/[（(\[【][^）)\]】]*[）)\]】]/g, ' ').replace(/\s+/g, ' ').trim()
    if (cleaned && !isPlaceholder(cleaned)) {
      artistName = cleaned
      nameSource = 'tag'
    } else {
      const fromName = extractArtistFromName(rawName)
      if (fromName) {
        artistName = fromName
        nameSource = 'filename'
      }
    }
  }

  if (!artistName) {
    const result: ArtistLookup = {
      intro: null,
      resolvedName: '',
      nameSource: 'none',
      tried: [],
      note: rawSinger || rawName ? '这首歌没有艺人信息（标签为空，文件名里也没有「艺人 - 歌名」）' : '没有可用的艺人信息',
    }
    cache.set(cacheKey, result)
    return result
  }

  // ---- 2) 搜（只认精确同名） ----
  const tried: string[] = []
  const notes: string[] = []
  const found: { netease: ArtistIntro | null, kugou: ArtistIntro | null } = { netease: null, kugou: null }

  const lfmPromise = getLastfmArtist(artistName).catch(() => null)

  tried.push(artistName)
  try {
    const { intro, note } = await tryNetease(artistName)
    if (intro) found.netease = intro
    else if (note) notes.push(note)
  } catch (e: any) {
    notes.push(`网易云请求失败：${e?.message ?? e}`)
  }
  if (!found.netease) {
    try {
      const { intro, note } = await tryKugou(artistName)
      if (intro) found.kugou = intro
      else if (note) notes.push(note)
    } catch (e: any) {
      notes.push(`酷狗请求失败：${e?.message ?? e}`)
    }
  }

  const lfm = await lfmPromise
  // Last.fm 也会模糊匹配，名字对不上就不用（避免标签/听众数张冠李戴）
  const lfmOk = !!(lfm && normName(String(lfm.name ?? '')) === normName(artistName))

  // ---- 3) 组装 ----
  let sections: ArtistIntroSection[] = []
  let source = ''
  if (found.netease) {
    sections = found.netease.sections
    source = found.netease.source
  } else if (found.kugou) {
    sections = found.kugou.sections
    source = found.kugou.source
  } else if (lfmOk && lfm && lfm.bio.length >= 40) {
    sections = lfm.bio.split(/\n{2,}/).map(t => t.trim()).filter(Boolean).map(t => ({ title: '', text: t }))
    source = 'Last.fm'
  }

  const intro: ArtistIntro | null = sections.length
    ? {
        name: found.netease?.name ?? found.kugou?.name ?? (lfmOk ? lfm?.name : undefined) ?? artistName,
        picUrl: found.netease?.picUrl ?? found.kugou?.picUrl ?? (lfmOk ? lfm?.image : null) ?? null,
        sections,
        source,
        tags: lfmOk && lfm?.tags?.length ? lfm.tags : undefined,
        listeners: (lfmOk && lfm?.listeners) || undefined,
        playcount: (lfmOk && lfm?.playcount) || undefined,
      }
    : null

  const result: ArtistLookup = {
    intro,
    resolvedName: artistName,
    nameSource,
    tried,
    note: intro ? undefined : (notes[0] ?? `没找到「${artistName}」的简介`),
  }
  cache.set(cacheKey, result)
  return result
}
