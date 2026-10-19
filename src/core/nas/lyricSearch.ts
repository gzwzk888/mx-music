/**
 * 在线歌词检索（直连，不依赖音源）
 *
 * 参考 foobar2000 ESLyric 的做法：
 *   1. 酷狗：明文 HTTP，search 拿 id+accesskey，download 取 base64 的 LRC
 *   2. LRCLIB：开放接口，无需 key，欧美/中文都有
 *
 * 用途：NAS / 本机歌曲在 LX 自带音源搜不到词时兜底
 */

export interface LyricQuery {
  title: string
  artist?: string | null
  album?: string | null
  /** 已格式化的 mm:ss，或秒数 */
  duration?: string | number | null
  /** 文件路径 / URL，用于兜底解析文件名 */
  filePath?: string | null
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const decodeBase64Utf8 = (input: string): string => {
  const str = input.replace(/[^A-Za-z0-9+/]/g, '')
  const bytes: number[] = []
  for (let i = 0; i < str.length; i += 4) {
    const c1 = B64.indexOf(str[i])
    const c2 = B64.indexOf(str[i + 1])
    const c3 = B64.indexOf(str[i + 2])
    const c4 = B64.indexOf(str[i + 3])
    if (c1 < 0 || c2 < 0) break
    bytes.push((c1 << 2) | (c2 >> 4))
    if (c3 >= 0) bytes.push(((c2 & 15) << 4) | (c3 >> 2))
    if (c4 >= 0) bytes.push(((c3 & 3) << 6) | c4)
  }
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++]
    if (b < 0x80) out += String.fromCharCode(b)
    else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f))
    else if (b < 0xf0) out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f))
    else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
      out += String.fromCodePoint(cp)
    }
  }
  return out
}

const clean = (s?: string | null): string => (s ?? '')
  .replace(/\.(flac|wav|mp3|ape|m4a|aac|ogg|wma|dff|dsf|iso)$/i, '')
  .replace(/^\s*\d{1,3}[\s._-]+/, '')
  .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const toSeconds = (v?: string | number | null): number => {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const m = /^(\d+):(\d+)(?::(\d+))?$/.exec(v.trim())
  if (!m) return Number(v) || 0
  return m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2])
}

const fetchText = async(url: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<string> => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => { ctrl.abort() }, timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

const hasTimestamps = (txt: string) => /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?]/.test(txt)

interface KugouCandidate {
  id?: string
  accesskey?: string
  song?: string
  singer?: string
  duration?: number
}

/** 酷狗：搜索候选 */
const kugouCandidates = async(title: string, artist: string, durationSec: number): Promise<KugouCandidate[]> => {
  const keyword = artist ? `${artist}-${title}` : title
  const durParam = durationSec ? `&duration=${Math.round(durationSec * 1000)}` : ''
  const url = `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(keyword)}${durParam}&hash=`
  const json = JSON.parse(await fetchText(url)) as { candidates?: KugouCandidate[] }
  const list = (json.candidates ?? []).filter(c => c.id && c.accesskey)
  // 时长越接近越可能对
  if (durationSec) {
    list.sort((a, b) => Math.abs((a.duration ?? 0) / 1000 - durationSec) - Math.abs((b.duration ?? 0) / 1000 - durationSec))
  }
  return list
}

/** 酷狗：下载明文 LRC（fmt=lrc，免解密） */
const kugouLyric = async(id: string, key: string): Promise<string> => {
  const url = `http://lyrics.kugou.com/download?ver=1&client=pc&id=${id}&accesskey=${key}&fmt=lrc&charset=utf8`
  const json = JSON.parse(await fetchText(url)) as { content?: string }
  if (!json.content) return ''
  const txt = decodeBase64Utf8(json.content).trim()
  return hasTimestamps(txt) ? txt : ''
}

/** LRCLIB：开放接口 */
const lrclibLyric = async(title: string, artist: string, durationSec: number): Promise<string> => {
  const qs = `track_name=${encodeURIComponent(title)}${artist ? `&artist_name=${encodeURIComponent(artist)}` : ''}`
  const arr = JSON.parse(await fetchText(`https://lrclib.net/api/search?${qs}`)) as Array<{ syncedLyrics?: string | null, duration?: number }>
  if (!Array.isArray(arr) || !arr.length) return ''
  const withSync = arr.filter(i => i.syncedLyrics && hasTimestamps(i.syncedLyrics))
  if (!withSync.length) return ''
  if (durationSec) {
    withSync.sort((a, b) => Math.abs((a.duration ?? 0) - durationSec) - Math.abs((b.duration ?? 0) - durationSec))
  }
  return withSync[0].syncedLyrics!.trim()
}


/* ---------------- QQ 音乐 ---------------- */

interface QqSong { mid?: string, name?: string, title?: string, interval?: number, singer?: Array<{ name?: string }> }

const decodeEntities = (txt: string): string => txt
  .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
  .replace(/&apos;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')

/** QQ：搜索候选（smartbox 轻量接口，比 musicu 搜索稳，不会被频繁限流） */
const qqCandidates = async(title: string, artist: string, durationSec: number): Promise<QqSong[]> => {
  const key = artist ? `${artist} ${title}` : title
  const url = `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${encodeURIComponent(key)}&format=json&inCharset=utf-8&outCharset=utf-8`
  const json = JSON.parse(await fetchText(url, { Referer: 'https://y.qq.com/' }))
  const list: any[] = json?.data?.song?.itemlist ?? []
  const mapped: QqSong[] = list
    .filter(s => s?.mid)
    .map(s => ({ mid: s.mid, name: s.name, singer: [{ name: s.singer }] }))

  // 歌名完全一致的排前面，其次是歌手名匹配的
  const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase()
  const titleKey = norm(title)
  const artistKey = norm(artist)
  mapped.sort((a, b) => {
    const score = (s: QqSong) => {
      let n = 0
      if (norm(s.name ?? '') === titleKey) n -= 4
      else if (norm(s.name ?? '').includes(titleKey) || titleKey.includes(norm(s.name ?? ''))) n -= 2
      const singer = norm((s.singer ?? [])[0]?.name ?? '')
      if (artistKey && singer && (singer.includes(artistKey) || artistKey.includes(singer))) n -= 3
      return n
    }
    return score(a) - score(b)
  })
  return mapped
}

/** QQ：按 songmid 取明文 LRC（nobase64=1 免解密） */
const qqLyric = async(mid: string): Promise<string> => {
  const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${mid}&format=json&nobase64=1&g_tk=5381`
  const json = JSON.parse(await fetchText(url, { Referer: 'https://y.qq.com/' }))
  const txt = decodeEntities(String(json?.lyric ?? '')).trim()
  return hasTimestamps(txt) ? txt : ''
}

/**
 * 依次尝试各歌词源，返回第一个带时间轴的 LRC
 */
export const searchOnlineLyric = async(query: LyricQuery): Promise<{ lyric: string, source: string } | null> => {
  let title = clean(query.title)
  let artist = clean(query.artist)

  // 元数据不行时退回文件名：常见 "01 - 歌手 - 歌名.flac"
  if (!title || !artist) {
    const fileName = (query.filePath ?? '').split('/').pop()?.split('?')[0] ?? ''
    const fromFile = clean(decodeURIComponent(fileName))
    if (fromFile) {
      const parts = fromFile.split(/\s*[-–—]\s*/).filter(Boolean)
      if (parts.length >= 2 && !artist) {
        artist = parts[0]
        title = parts.slice(1).join(' ')
      } else if (!title) {
        title = fromFile
      }
    }
  }
  if (!title) return null

  const durationSec = toSeconds(query.duration)

  try {
    const cands = await kugouCandidates(title, artist, durationSec)
    for (const c of cands.slice(0, 3)) {
      const lyric = await kugouLyric(c.id!, c.accesskey!)
      if (lyric) return { lyric, source: `酷狗 · ${c.singer ?? ''} ${c.song ?? ''}`.trim() }
    }
  } catch {}

  try {
    const cands = await qqCandidates(title, artist, durationSec)
    for (const c of cands.slice(0, 3)) {
      const lyric = await qqLyric(c.mid!)
      if (lyric) return { lyric, source: `QQ音乐 · ${(c.singer ?? []).map(x => x.name).filter(Boolean).join('/')} ${c.name ?? ''}`.trim() }
    }
  } catch {}

  try {
    const lyric = await lrclibLyric(title, artist, durationSec)
    if (lyric) return { lyric, source: 'LRCLIB' }
  } catch {}

  return null
}

/* ---------------- 人工搜索：候选列表 + 按候选取词 ---------------- */

export interface LyricCandidate {
  key: string
  source: '酷狗' | 'QQ音乐' | 'LRCLIB'
  title: string
  artist: string
  /** 供取词使用的定位串 */
  ref: string
  duration?: number
}

/** 按关键词搜候选（歌名 / 歌手 / “歌手 歌名”都行） */
export const searchLyricCandidates = async(keyword: string): Promise<LyricCandidate[]> => {
  const kw = keyword.trim()
  if (!kw) return []
  const out: LyricCandidate[] = []

  // 酷狗
  try {
    const cands = await kugouCandidates(kw, '', 0)
    for (const c of cands.slice(0, 10)) {
      out.push({
        key: `kg:${c.id}`,
        source: '酷狗',
        title: String(c.song ?? ''),
        artist: String(c.singer ?? ''),
        ref: `${c.id}|${c.accesskey}`,
        duration: c.duration,
      })
    }
  } catch {}

  // QQ（smartbox 关键词直接搜）
  try {
    const qq = await qqCandidates(kw, '', 0)
    for (const c of qq.slice(0, 10)) {
      out.push({
        key: `qq:${c.mid}`,
        source: 'QQ音乐',
        title: String(c.name ?? ''),
        artist: (c.singer ?? []).map(x => x.name).filter(Boolean).join('/'),
        ref: String(c.mid),
      })
    }
  } catch {}

  // LRCLIB
  try {
    const qs = `track_name=${encodeURIComponent(kw)}`
    const arr = JSON.parse(await fetchText(`https://lrclib.net/api/search?${qs}`)) as Array<{ id?: number, trackName?: string, artistName?: string, syncedLyrics?: string | null }>
    for (const item of (arr ?? []).slice(0, 10)) {
      if (!item?.syncedLyrics) continue
      out.push({
        key: `lr:${item.id ?? item.trackName}`,
        source: 'LRCLIB',
        title: String(item.trackName ?? ''),
        artist: String(item.artistName ?? ''),
        ref: String(item.id ?? ''),
      })
    }
  } catch {}

  return out
}

/** 按候选取回 LRC 文本 */
export const fetchLyricForCandidate = async(c: LyricCandidate): Promise<string> => {
  if (c.source == '酷狗') {
    const [id, key] = c.ref.split('|')
    return await kugouLyric(id, key)
  }
  if (c.source == 'QQ音乐') {
    return await qqLyric(c.ref)
  }
  // LRCLIB：按 id 或歌名再取一次
  try {
    if (c.ref) {
      const one = JSON.parse(await fetchText(`https://lrclib.net/api/get/${c.ref}`)) as { syncedLyrics?: string | null }
      if (one?.syncedLyrics) return one.syncedLyrics
    }
  } catch {}
  return await lrclibLyric(c.title, c.artist, 0)
}

/** 用当前歌曲信息自动搜一轮（歌词页失败后调用） */
export const searchLyricBySong = async(title: string, artist: string): Promise<LyricCandidate[]> => {
  const kw = [artist, title].filter(Boolean).join(' ').trim()
  return await searchLyricCandidates(kw)
}
