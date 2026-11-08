/**
 * NAS 全库索引：按「文件夹树」遍历得到全部曲目（用于全盘搜索、歌单跳转）
 *
 * 两个针对 QNAP DLNA 的实测适配：
 *  1. QNAP 忽略 StartingIndex / MaximumItems：同一容器不管要第几页，都返回同一批数据。
 *     → 所以分页只做「探测性」请求，一旦发现首项重复就停止；并且只走文件夹树，
 *       不遍历 Songs / Artist / Album / Genre 这些「视图容器」（它们会大量重复同一批歌）。
 *  2. 单容器一次可能返回几千条 → 只保留去重后的曲目，避免索引膨胀。
 */

import { applyCueRanges, browse, type NasDevice, type NasItem } from './dlna'
import { setNasIndex, getNasIndex } from './session'
import { addGenres } from '@/core/local/genreDict'
import { resetThumbMemCache } from '@/core/local/coverCache'

const SUPPORTED_EXT = new Set(['flac', 'wav', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'alac', 'mka', 'mp2'])

export interface NasSongIndex {
  id: string
  cueStart?: number
  cueEnd?: number
  title: string
  artist: string
  album: string
  url: string
  ext: string
  interval: string | null
  /** 所在目录标题 */
  folder: string
  /** DLNA 曲目封面地址（服务器给出时才有；实测 QNAP 的地址对普通客户端 404，仅作参考） */
  artUrl?: string | null
  /** 封面内容 SHA-1（缩略图缓存键）；空 = 确认没有封面 */
  coverHash?: string
  /** 风格（upnp:genre） */
  genre?: string
}

export interface NasFolderIndex {
  id: string
  title: string
  /** 父目录标题（用于面包屑） */
  parent: string
}

/**
 * NAS 曲目的可读路径：DLNA 的 res URL 是对象 ID（MediaItems/A0$128$129$…），
 * 不能当路径展示；用索引里的目录标题 + 歌名 + 扩展名代替
 * → 祝福十三首XRCD/流金岁月.flac
 */
export const nasSongPathText = (folder: string | undefined, title: string, ext: string): string => {
  const base = (title || '').trim() || '(未命名)'
  const hasExt = !!ext && new RegExp(`\\.${ext}$`, 'i').test(base)
  const fileName = ext && !hasExt ? `${base}.${ext}` : base
  const dir = (folder || '').trim()
  return dir ? `${dir}/${fileName}` : fileName
}

export interface NasIndex {
  songs: NasSongIndex[]
  folders: NasFolderIndex[]
  builtAt: number
  scanned: number
}

/** DLNA 的「视图容器」：内容和文件夹树重复，遍历它们只会放大请求量 */
const VIEW_CONTAINERS = new Set([
  'songs', 'artist', 'album', 'genre', 'year', 'rating',
  'recently added', 'frequently played', 'recently played',
  'random 100', 'never played', 'playlist', 'playlists',
])

const PAGE = 100
const CONCURRENCY = 4
const MAX_FOLDERS = 4000

/** 取一个容器的子项；检测到服务端忽略分页时立即停止，避免死循环 */
const fetchChildren = async(
  dev: NasDevice,
  dirId: string,
  onPage?: (loaded: number) => void,
) => {
  const first = await browse(dev, dirId, 0, PAGE)
  const items = [...first.items]
  const total = first.total > 0 ? first.total : items.length
  onPage?.(items.length)

  // 已拿全，或服务端一次就给了超出一页的量（忽略分页）→ 不再翻页
  if (items.length >= total) return items
  if (items.length > PAGE) return items

  const firstId = items[0]?.id
  let start = items.length
  let guard = 0
  while (start < total && guard++ < 200) {
    const chunk = await browse(dev, dirId, start, PAGE)
    const next = chunk.items
    if (!next.length) break
    if (next[0]?.id === firstId) break   // 服务端忽略了 StartingIndex
    items.push(...next)
    start += next.length
    onPage?.(items.length)
    if (next.length < PAGE) break
  }
  return items
}

export const buildNasIndex = async(
  dev: NasDevice,
  onProgress?: (msg: string) => void,
  shouldAbort?: () => boolean,
  opts?: { force?: boolean },
): Promise<NasIndex> => {
  // 重建前先记住旧的 url → coverHash：缩略图是按内容哈希存在磁盘上的，
  // 曲目没变就没必要丢掉这层映射（否则重建一次，之前扫的封面全部失效）
  const prevCover = new Map<string, string>()
  if (opts?.force) {
    const prevIdx = getNasIndex()
    if (prevIdx) {
      for (const s of prevIdx.songs) {
        if (s.coverHash) prevCover.set(s.url, s.coverHash)
      }
    }
  }
  // 重建索引一律从空表开始：先清掉旧索引和封面缓存，界面上能立刻看到「已清空」
  if (opts?.force) {
    onProgress?.(prevCover.size
      ? `已清空旧索引，重新扫描…（沿用 ${prevCover.size} 个已扫封面）`
      : '已清空旧索引，重新扫描…')
    setNasIndex(null)
    // 只清内存映射：缩略图按内容哈希存，重新扫出来还是同一批文件，没必要删
    resetThumbMemCache()
  }
  const songs: NasSongIndex[] = []
  const folders: NasFolderIndex[] = []
  const seenUrl = new Set<string>()
  const seenId = new Set<string>()
  let scanned = 0

  // 起点：优选根目录下的「Music / 音乐」；名字不叫这个（QNAP 的 Multimedia、自定义共享夹等）
  // 就从根目录所有文件夹开始扫——否则索引会安静地扫出 0 首，音乐库看着像「NAS 数据没了」
  const root = await browse(dev, '0', 0, 50)
  const isFolder = (i: NasItem) => i.isContainer && !VIEW_CONTAINERS.has(i.title.trim().toLowerCase())
  const music = root.items.find(i => i.isContainer && /^music$|音乐|音樂/i.test(i.title))

  let startNodes: NasItem[] = []
  if (music) {
    const musicKids = await fetchChildren(dev, music.id, () => {})
    const folderNode = musicKids.find(i => i.isContainer && /^folder$|文件夹|資料夾/i.test(i.title))
    startNodes = folderNode ? [folderNode] : musicKids.filter(isFolder)
  }
  if (!startNodes.length) startNodes = root.items.filter(isFolder)

  const queue: Array<{ id: string, title: string, parent: string }> =
    startNodes.map(n => ({ id: n.id, title: n.title, parent: '' }))

  // 并发遍历（逐层扩展）
  while (queue.length && scanned < MAX_FOLDERS) {
    if (shouldAbort?.()) {
      onProgress?.(`已取消：扫描了 ${scanned} 个目录，${songs.length} 首`)
      return { songs, folders, builtAt: Date.now(), scanned }
    }
    const batch = queue.splice(0, Math.min(CONCURRENCY * 6, queue.length - 0))
    const results = await Promise.all(batch.map(async dir => {
      if (seenId.has(dir.id)) return null
      seenId.add(dir.id)
      try {
        const items = await fetchChildren(dev, dir.id, loaded => {
          if (loaded > PAGE) onProgress?.(`读取「${dir.title}」${loaded} 项…`)
        })
        return { dir, items }
      } catch {
        return { dir, items: [] }
      }
    }))

    for (const res of results) {
      if (!res) continue
      const { dir } = res
      const items = applyCueRanges(res.items)
      scanned++
      for (const it of items) {
        if (it.isContainer) {
          const low = it.title.trim().toLowerCase()
          if (VIEW_CONTAINERS.has(low)) continue
          if (!seenId.has(it.id)) queue.push({ id: it.id, title: it.title, parent: dir.title })
        } else if (it.url && SUPPORTED_EXT.has(it.ext)) {
          if (seenUrl.has(it.url)) continue
          seenUrl.add(it.url)
          songs.push({
            id: it.id,
            title: it.title,
            artist: it.artist,
            album: (it.album || '').trim() || dir.title,
            url: it.url,
            ext: it.ext,
            interval: it.interval,
            folder: dir.title,
            artUrl: it.artUrl || null,
            genre: (it.genre || '').trim(),
            // 沿用上一次索引里这一首的封面哈希（文件没变就别重扫）
            coverHash: prevCover.get(it.url),
          })
        }
      }
      if (dir.title != '根目录' && dir.title != 'Folder') folders.push({ id: dir.id, title: dir.title, parent: dir.parent })
      if (scanned % 10 == 0) onProgress?.(`已扫描 ${scanned} 个目录，${seenUrl.size} 首`)
    }
  }

  onProgress?.(`索引完成：${scanned} 个目录，${songs.length} 首`)
  void addGenres(songs.map(s => s.genre)).catch(() => {})
  return { songs, folders, builtAt: Date.now(), scanned }
}

/** 目录名 → 匹配到最像的文件夹（专辑跳转用） */
export const findFolderByTitle = (folders: NasFolderIndex[], title: string): NasFolderIndex | null => {
  const norm = (v: string) => v.toLowerCase().replace(/[\s\-_().（）《》【】\[\]"'“”‘’·、，,]/g, '')
  const want = norm(title)
  if (!want) return null
  let exact: NasFolderIndex | null = null
  let partial: NasFolderIndex | null = null
  for (const f of folders) {
    const key = norm(f.title)
    if (key == want) { exact = f; break }
    if (!partial && (key.includes(want) || want.includes(key))) partial = f
  }
  return exact ?? partial
}

/**
 * 从目录标题回溯出「根 → 目标」的完整文件夹链（面包屑用）。
 * 索引里只有 parent 标题，所以逐级按标题上溯；同名目录靠 parent 链消歧。
 * 返回空数组表示索引里没有这个目录。
 */
export const buildFolderStack = (folders: NasFolderIndex[], folderTitle: string): NasFolderIndex[] => {
  const want = (folderTitle ?? '').trim()
  if (!want) return []
  // 优先精确同名，避免 findFolderByTitle 的模糊匹配抓错
  const norm = (v: string) => v.toLowerCase().replace(/[\s\-_().（）《》【】\[\]"'“”‘’·、，,]/g, '')
  const exact = folders.find(f => norm(f.title) == norm(want))
  let cur = exact ?? findFolderByTitle(folders, want)

  const chain: NasFolderIndex[] = []
  const seen = new Set<string>()
  let guard = 0
  while (cur && guard++ < 24) {
    if (seen.has(cur.id)) break
    seen.add(cur.id)
    chain.unshift(cur)
    if (!cur.parent) break
    const parentKey = norm(cur.parent)
    cur = folders.find(f => norm(f.title) == parentKey) ?? findFolderByTitle(folders, cur!.parent)
    // 上溯到根 / Folder 这类伪目录就停
    if (cur && /^(根目录|folder|music|音乐)$/i.test(cur.title.trim())) break
  }
  return chain
}
