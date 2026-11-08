/**
 * 读取 NAS 上的播放列表（兼容不同服务器的命名）
 * 典型结构： 根 → Music → Playlist → [list_1, list2, …] → 歌曲
 */

import { applyCueRanges, browse, type NasDevice, type NasItem } from './dlna'

/** 播放列表容器的可能名字（小写包含匹配） */
const KEYS = [
  'playlist', 'play list', 'playlists', '播放列表', '歌单', '我的播放列表',
  'my playlist', 'myplaylist', 'mylist', 'my list', 'favorites', 'favourite',
  '收藏', '最爱', '喜好', '我爱听',
]

export interface NasPlaylistInfo {
  id: string
  title: string
  count: number
}

const findMusicContainer = async(dev: NasDevice): Promise<NasItem | null> => {
  const root = await browse(dev, '0', 0, 50)
  return root.items.find(i => i.isContainer && /music|音乐|audio/i.test(i.title)) ?? null
}

/** 找到播放列表容器 + 其中的每个列表 */
export const listNasPlaylists = async(dev: NasDevice): Promise<{ container: NasItem | null, lists: NasPlaylistInfo[] }> => {
  const music = await findMusicContainer(dev)
  if (!music) return { container: null, lists: [] }

  const children = await browse(dev, music.id, 0, 100)
  // 优先精确 playlist，其次包含关键词
  const containers = children.items.filter(i => i.isContainer)
  const hit = containers.find(i => /^playlists?$/i.test(i.title.trim())) ??
    containers.find(i => KEYS.some(k => i.title.toLowerCase().includes(k)))
  if (!hit) return { container: null, lists: [] }

  const inner = await browse(dev, hit.id, 0, 200)
  const lists: NasPlaylistInfo[] = inner.items
    .filter(i => i.isContainer)
    .map(i => ({ id: i.id, title: i.title, count: i.childCount }))

  return { container: hit, lists }
}

/** 把所有播放列表里的歌收集起来（去重，保持列表顺序） */
export const loadNasPlaylistSongs = async(
  dev: NasDevice,
  onProgress?: (msg: string) => void,
): Promise<{ songs: NasItem[], lists: NasPlaylistInfo[] }> => {
  const { lists } = await listNasPlaylists(dev)
  const songs: NasItem[] = []
  const seen = new Set<string>()

  for (const pl of lists) {
    let start = 0
    while (true) {
      const { items, total } = await browse(dev, pl.id, start, 300)
      if (!items.length) break
      for (const it of items) {
        if (it.isContainer || !it.url) continue
        if (seen.has(it.url)) continue
        seen.add(it.url)
        songs.push(it)
      }
      start += items.length
      if (total > 0 ? start >= total : items.length < 300) break
    }
    onProgress?.(`读取播放列表「${pl.title}」：累计 ${songs.length} 首`)
  }

  return { songs, lists }
}

export interface NasPlaylistDetail {
  title: string
  songs: NasItem[]
}


const PAGE = 100
const PAGE_CONCURRENCY = 4

/** 取一个列表容器下的全部曲目：先取第一页拿总数，其余页 4 路并发（QNAP 单次上限约 100 条） */
const fetchAllItems = async(
  dev: NasDevice,
  containerId: string,
  onPage?: (loaded: number, total: number) => void,
): Promise<NasItem[]> => {
  const first = await browse(dev, containerId, 0, PAGE)
  const items = [...first.items]
  const total = first.total > 0 ? first.total : items.length
  onPage?.(items.length, total)

  // QNAP 会忽略 StartingIndex：一次返回多于一页就不要继续翻页，否则只是重复请求
  if (items.length > PAGE || items.length >= total) return items
  const pages = Math.min(Math.ceil(total / PAGE), 50)
  if (pages <= 1) return items

  let next = 1
  const worker = async() => {
    while (true) {
      const idx = next++
      if (idx >= pages) return
      try {
        const { items: chunk } = await browse(dev, containerId, idx * PAGE, PAGE)
        if (chunk.length) items.push(...chunk)
        onPage?.(items.length, total)
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, () => worker()))
  return items
}

/**
 * 逐个播放列表读取（不合并、不跨列表去重，保持 NAS 里的原始顺序）
 * 分页上限 5000 首，避免服务端 TotalMatches 与实际不一致时死循环
 */
export const loadNasPlaylistsDetailed = async(
  dev: NasDevice,
  onProgress?: (msg: string) => void,
): Promise<NasPlaylistDetail[]> => {
  const { lists } = await listNasPlaylists(dev)
  const out: NasPlaylistDetail[] = []

  for (const pl of lists) {
    const raw = applyCueRanges(await fetchAllItems(dev, pl.id, (loaded, total) => {
      if (total > PAGE) onProgress?.(`读取「${pl.title}」${loaded}/${total} 首…`)
    }))
    const songs: NasItem[] = []
    const seen = new Set<string>()
    for (const it of raw) {
      if (it.isContainer || !it.url) continue
      if (seen.has(it.id)) continue
      seen.add(it.id)
      songs.push(it)
    }
    out.push({ title: pl.title, songs })
    onProgress?.(`读取「${pl.title}」${songs.length} 首`)
  }

  return out
}
