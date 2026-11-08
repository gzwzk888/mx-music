/**
 * 本机音乐：按「用户指定的目录」扫描（不像 MediaStore 那样全盘扫）
 *
 * - 目录列表与扫描结果都落盘，App 重启后先用缓存立即显示，再后台重扫
 * - 增量：文件 size + mtime 没变就不重新读标签，几千首也只有首次慢
 * - 每次 App 启动自动重扫一次（Library 页挂载时触发，模块级只跑一次）
 */
import { getData, saveData } from '@/plugins/storage'
import { PermissionsAndroid } from 'react-native'
import { getExternalStoragePaths } from '@/utils/fs'
import { addGenres } from '@/core/local/genreDict'
import { findFolderCover, findRemoteFolderCover } from '@/utils/folderCover'
import { makeThumbFromFile, makeThumbFromImage, thumbOf } from '@/core/local/coverCache'
import { readRemoteArt } from '@/core/nas/embeddedArt'
import {
  androidVersion, hasAllFilesAccess, openAllFilesSettings, readAudioTags, readEmbeddedCover,
  scanAudioDirs, type ScannedAudioFile,
} from '@/utils/nativeModules/mediaScan'

const DIRS_KEY = '@mx_local_dirs_v1'
const INDEX_KEY = '@mx_local_index_v2'

export interface LocalDir {
  path: string
  name: string
  addedAt: number
}

export interface LocalSong {
  path: string
  fileName: string
  size: number
  mtime: number
  title: string
  artist: string
  album: string
  /** 风格标签；没有则空串 */
  genre: string
  /** 是否有封面（以缩略图缓存里真有一张为准） */
  hasCover: boolean
  /** 封面内容 SHA-1（缩略图缓存键）；空 = 没有封面 */
  coverHash?: string
  /** 毫秒 */
  duration: number
  /** 所属已添加目录 */
  dir: string
}

interface PersistIndex {
  songs: LocalSong[]
  scannedAt: number
}

/** 路径 → 封面哈希（扫描时登记；NAS 由索引提供） */
const hashByPath = new Map<string, string>()

let dirs: LocalDir[] = []
let songs: LocalSong[] = []
let scannedAt = 0
let loaded = false
let autoScanned = false
let scanning = false

const dirName = (path: string) => {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

/** 常见根目录，供目录浏览器默认进入 */
export const defaultBrowseRoot = async(): Promise<string> => {
  try {
    const paths = await getExternalStoragePaths()
    if (paths?.length) return paths[0]
  } catch {}
  return '/storage/emulated/0'
}

export const ensureLoaded = async(): Promise<void> => {
  if (loaded) return
  loaded = true
  const [d, idx] = await Promise.all([
    getData<LocalDir[]>(DIRS_KEY),
    getData<PersistIndex>(INDEX_KEY),
  ])
  dirs = d ?? []
  songs = idx?.songs ?? []
  scannedAt = idx?.scannedAt ?? 0
  // 索引里登记过的封面哈希 → 内存映射，getCover 直接命中缩略图
  hashByPath.clear()
  for (const song of songs) {
    if (song.coverHash) hashByPath.set(song.path, song.coverHash)
  }
}

/** 启动时预热：提前把本机索引从存储读进内存（进「音乐库」时就不用等） */
export const preloadLocalIndex = () => { void ensureLoaded().catch(() => {}) }

export const getDirs = (): LocalDir[] => dirs

export const getSongs = (): LocalSong[] => songs

export const getScannedAt = (): number => scannedAt

export const isScanning = (): boolean => scanning

export const addDir = async(path: string): Promise<boolean> => {
  await ensureLoaded()
  const p = path.replace(/\/+$/, '')
  if (!p) return false
  if (dirs.some(d => d.path == p)) return false
  // 已有子目录时，父目录加进来会重复扫描 → 直接换掉子目录
  const children = dirs.filter(d => d.path.startsWith(p + '/'))
  if (children.length) {
    dirs = dirs.filter(d => !children.some(c => c.path == d.path))
  } else if (dirs.some(d => p.startsWith(d.path + '/'))) {
    // 父目录已在列表里，不用再加
    return false
  }
  dirs = [...dirs, { path: p, name: dirName(p), addedAt: Date.now() }]
  await saveData(DIRS_KEY, dirs)
  return true
}

export const removeDir = async(path: string): Promise<void> => {
  await ensureLoaded()
  dirs = dirs.filter(d => d.path != path)
  songs = songs.filter(s => s.dir != path)
  await Promise.all([saveData(DIRS_KEY, dirs), saveData(INDEX_KEY, { songs, scannedAt } as PersistIndex)])
  try { global.state_event.mxLocalIndexUpdated(songs.length) } catch {}
}

export interface ScanProgress {
  phase: 'list' | 'tags'
  done: number
  total: number
  text: string
}

export interface ScanResult {
  total: number
  added: number
  updated: number
  removed: number
  dirs: number
  missing: string[]
}

/**
 * 清空本机索引 + 封面缓存（「重新扫描」前调用）
 * 只清索引，不动用户添加的目录列表
 */
export const clearLocalIndex = async(): Promise<void> => {
  await ensureLoaded()
  songs = []
  scannedAt = 0
  coverCache.clear()
  await saveData(INDEX_KEY, { songs: [], scannedAt: 0 } as PersistIndex)
  try { global.state_event.mxLocalIndexUpdated(0) } catch {}
}

/**
 * 重扫全部已添加目录
 * 进度是事件驱动的（每读完一个文件 / 每 20 个标签回调一次），不是定时刷新
 */
export const scanAll = async(
  onProgress?: (p: ScanProgress) => void,
  opts?: { force?: boolean },
): Promise<ScanResult> => {
  await ensureLoaded()
  if (scanning) return { total: songs.length, added: 0, updated: 0, removed: 0, dirs: dirs.length, missing: [] }
  if (!dirs.length) return { total: 0, added: 0, updated: 0, removed: 0, dirs: 0, missing: [] }

  // 强制重扫：先把旧表和封面缓存全清掉，避免残留脏数据（新增字段时尤其重要）
  if (opts?.force) {
    onProgress?.({ phase: 'list', done: 0, total: 0, text: '已清空索引，重新扫描…' })
    await clearLocalIndex()
  }

  scanning = true
  try {
    onProgress?.({ phase: 'list', done: 0, total: 0, text: '正在读取目录…' })
    const files = await scanAudioDirs(dirs.map(d => d.path))
    const cache = opts?.force ? new Map<string, LocalSong>() : new Map(songs.map(s => [s.path, s]))
    const next: LocalSong[] = []
    let added = 0
    let updated = 0
    let done = 0

    const belongsTo = (path: string): string => {
      const hit = dirs.filter(d => path == d.path || path.startsWith(d.path + '/'))
        .sort((a, b) => b.path.length - a.path.length)[0]
      return hit?.path ?? ''
    }

    for (const f of files as ScannedAudioFile[]) {
      const dir = belongsTo(f.path)
      if (!dir || f.dup) continue
      const old = cache.get(f.path)
      if (old && old.size == f.size && old.mtime == f.mtime) {
        next.push({ ...old, dir })
        done++
        if (done % 50 == 0) onProgress?.({ phase: 'tags', done, total: files.length, text: `已扫描 ${done}/${files.length} 首` })
        continue
      }
      const tags = await readAudioTags(f.path)
      // 逐张读取内嵌封面 → SHA-1 → 512px 缩略图（只认哈希去重）。
      // 拿不到图片（空 PICTURE 块 / 无内嵌图）就判定「没有封面」，宁可空着也不显示占位图。
      let thumb = await makeThumbFromFile(f.path)
      if (!thumb) {
        // 没有内嵌图（WAV 常见）→ 用同目录 cover.jpg 之类生成缩略图
        const folderCover = await findFolderCover(f.path).catch(() => null)
        if (folderCover) thumb = await makeThumbFromImage(folderCover)
      }
      next.push({
        path: f.path,
        fileName: f.name,
        size: f.size,
        mtime: f.mtime,
        title: tags?.title?.trim() || f.name.replace(/\.[^.]+$/, ''),
        artist: tags?.artist?.trim() || '',
        album: tags?.album?.trim() || '',
        genre: (tags?.genre ?? '').trim(),
        hasCover: !!thumb?.thumb,
        coverHash: thumb?.hash ?? '',
        duration: tags?.duration ?? 0,
        dir,
      })
      if (old) updated++
      else added++
      done++
      // 读标签较慢：每 10 个刷一次进度，用户能看到在动
      if (done % 10 == 0 || done == files.length) {
        onProgress?.({ phase: 'tags', done, total: files.length, text: `读取标签 ${done}/${files.length}` })
      }
    }

    const removed = songs.length - next.filter(s => cache.has(s.path)).length
    songs = next
    scannedAt = Date.now()
    await saveData(INDEX_KEY, { songs, scannedAt } as PersistIndex)
    // 扫描完顺手更新风格字典（本机与 NAS 共用一份）
    void addGenres(next.map(s => s.genre)).catch(() => {})
    // 通知「音乐库」等只读视图刷新（索引的唯一写入方是本机曲库）
    try { global.state_event.mxLocalIndexUpdated(songs.length) } catch {}
    return { total: songs.length, added, updated, removed: Math.max(0, removed), dirs: dirs.length, missing: [] }
  } finally {
    scanning = false
  }
}

/** App 启动后自动扫一次（模块级只跑一次） */
export const autoScanOnce = async(onProgress?: (p: ScanProgress) => void): Promise<ScanResult | null> => {
  if (autoScanned) return null
  autoScanned = true
  await ensureLoaded()
  if (!dirs.length) return null
  try {
    return await scanAll(onProgress)
  } catch {
    return null
  }
}

/** 确保拿到「所有文件访问」权限；返回是否已授权 */
export const ensureAllFilesAccess = async(): Promise<boolean> => {
  if (await hasAllFilesAccess()) return true
  // Android 10 及以下没有「所有文件访问」这个权限，改为申请运行时读取权限
  // （车机版 targetSdk 29 走 legacy 存储，拿到 READ_EXTERNAL_STORAGE 就能列目录）
  if (androidVersion() < 30) {
    try {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE)
      return r === PermissionsAndroid.RESULTS.GRANTED
    } catch {
      return false
    }
  }
  await openAllFilesSettings()
  return false
}

/* ------------------------------ 封面（按需） ------------------------------ */

const coverCache = new Map<string, string | null>()

export const setCoverHash = (path: string, hash?: string | null) => {
  if (hash) hashByPath.set(path, hash)
  else hashByPath.delete(path)
}
export const getCoverHash = (path: string) => hashByPath.get(path)

const getCoverInner = async(path: string): Promise<string | null> => {
  // 0) 命中缩略图缓存：直接给本地小图，避免再读一遍原文件（NAS 也不用走网络）
  const hash = hashByPath.get(path)
  if (hash) {
    const thumb = await thumbOf(hash)
    if (thumb) {
      coverCache.set(path, thumb)
      return thumb
    }
  }
  if (coverCache.has(path)) return coverCache.get(path)!
  let cover: string | null = null
  /** 结果是否可信：网络失败时不可信，不能写进缓存，否则这首歌会被永久打成「没封面」 */
  let definitive = true
  if (path.startsWith('http://') || path.startsWith('https://')) {
    // NAS / 远程：先读文件内嵌封面（HTTP Range 两段式），再探同目录 cover.jpg
    try {
      cover = await readRemoteArt(path)
      if (!cover) cover = await findRemoteFolderCover(path).catch(() => null)
    } catch {
      definitive = false
    }
  } else {
    // 1) 先抽文件内嵌封面（FLAC / MP3 等）
    cover = await readEmbeddedCover(path)
    // 2) 读不到（WAV 没有标准封面字段）→ 用同目录的 cover.jpg / 封面.png
    if (!cover) cover = await findFolderCover(path)
  }
  if (definitive) coverCache.set(path, cover)
  return cover
}

/* --------------------------- 封面读取队列 ---------------------------
 * 为什么要有：一屏十几个格子会同时调 getCover，每个 NAS 封面要走 2~4 次 Range
 * 请求，而 QNAP 每次响应后主动断连。不设上限就是几十个并发挤爆连接池，
 * 表现为「封面慢 + 切菜单卡顿」——回调风暴把 JS 线程灌满，严重时 ANR。
 *
 * 策略：固定并发 3、严格先进先出（列表顺序即加载顺序）、同一路径只排一次。
 */
const COVER_CONCURRENCY = 3
let coverRunning = 0
const coverWaiters: Array<() => void> = []
/** 同一路径的并发请求合并成一个 Promise，避免重复读 */
const coverInflight = new Map<string, Promise<string | null>>()

const pumpCoverQueue = () => {
  while (coverRunning < COVER_CONCURRENCY && coverWaiters.length) {
    const job = coverWaiters.shift()!
    coverRunning++
    job()
  }
}

/** 取封面：命中内存缓存直接返回（不占队列），否则排队，最多 3 个并发 */
export const getCover = (path: string): Promise<string | null> => {
  // 快路径：已经取过的（包括「确认没封面」）立刻返回
  if (coverCache.has(path)) return Promise.resolve(coverCache.get(path)!)

  const hit = coverInflight.get(path)
  if (hit) return hit

  const p = new Promise<string | null>(resolve => {
    coverWaiters.push(() => {
      getCoverInner(path)
        .catch(() => null)
        .then(v => { resolve(v) })
        .finally(() => {
          coverRunning--
          pumpCoverQueue()
        })
    })
    pumpCoverQueue()
  })

  coverInflight.set(path, p)
  void p.then(() => { coverInflight.delete(path) })
  return p
}
