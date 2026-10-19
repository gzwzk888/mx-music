/**
 * 直连网易云公开接口取歌词（不走 LX 的音源插件）
 * 用途：NAS/本地歌曲的歌词兜底，避免依赖已失效的在线音源
 */

interface NeteaseArtist { name?: string }
interface NeteaseSong {
  id: number
  name?: string
  artists?: NeteaseArtist[]
  ar?: NeteaseArtist[]
  duration?: number
  dt?: number
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.·'"()（）\[\]【】]/g, '')

/** 给候选结果打分：歌手命中占大头，标题相似占小头 */
const scoreOf = (song: NeteaseSong, title: string, artist: string): number => {
  const sName = norm(song.name ?? '')
  const sSinger = norm((song.artists ?? song.ar ?? []).map(a => a.name ?? '').join('/'))
  const tName = norm(title)
  const tSinger = norm(artist)
  let score = 0
  if (tSinger && sSinger.includes(tSinger)) score += 60
  if (tName && sName === tName) score += 40
  else if (tName && (sName.includes(tName) || tName.includes(sName))) score += 20
  return score
}

const fetchJson = async(url: string): Promise<any> => {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return await resp.json()
}

/** 搜索最匹配的一首，返回 songId */
export const findSongId = async(title: string, artist: string): Promise<number | null> => {
  const q = encodeURIComponent(`${title} ${artist}`.trim())
  const data = await fetchJson(`https://music.163.com/api/cloudsearch/pc?s=${q}&type=1&limit=10`)
  const songs: NeteaseSong[] = data?.result?.songs ?? []
  if (!songs.length) return null
  let best: { id: number, score: number } | null = null
  for (const song of songs) {
    if (!song?.id) continue
    const score = scoreOf(song, title, artist)
    if (!best || score > best.score) best = { id: song.id, score }
  }
  // 分数太低说明没匹配上（宁可不给词，也不给错词）
  return best && best.score >= 40 ? best.id : null
}

/** 取单曲 LRC 文本 */
export const fetchLyricById = async(songId: number): Promise<string | null> => {
  const data = await fetchJson(`https://music.163.com/api/song/lyric?os=pc&id=${songId}&lv=-1&kv=-1&tv=-1`)
  const lrc: string = data?.lrc?.lyric ?? ''
  return lrc.trim() ? lrc : null
}

/** 一站式：标题+歌手 → LRC（失败返回 null） */
export const fetchNeteaseLyric = async(title: string, artist: string): Promise<string | null> => {
  try {
    const id = await findSongId(title, artist)
    if (!id) return null
    return await fetchLyricById(id)
  } catch {
    return null
  }
}
