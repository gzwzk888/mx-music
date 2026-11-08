/**
 * NAS / 本机音乐的会话与缓存
 *   - 内存态：切换菜单（组件被卸载）后仍保留
 *   - 磁盘态：App 重启后仍保留
 */

import { getData, saveData } from '@/plugins/storage'
import type { NasDevice, NasItem } from './dlna'
import { setCoverHash } from '@/core/local/dirs'
import { type LocalAudioFile, queryAudioFiles, requestMediaPermission } from '@/utils/nativeModules/mediaScan'
import type { NasIndex } from './nasIndex'

const NAS_KEY = '@mod_nas_session'
const LOCAL_KEY = '@mod_local_files'
const LOCAL_META_KEY = '@mod_local_scan_at'
const INDEX_KEY = '@mod_nas_index_v2'

export interface NasCrumb { id: string, title: string }

export interface NasSession {
  host: string
  device: NasDevice | null
  crumbs: NasCrumb[]
  items: NasItem[]
  total: number
  savedAt: number
}

let nas: NasSession = { host: '', device: null, crumbs: [], items: [], total: 0, savedAt: 0 }
let localFiles: LocalAudioFile[] = []

// 播放列表同步标记（持久化：同一台 NAS 只自动同步一次，重启 App 也不再重复）
const PLAYLISTS_SYNCED_KEY = '@mod_nas_playlists_synced'
let playlistsSynced: { host: string, at: number } = { host: '', at: 0 }
let playlistsSyncedLoaded = false
let localScannedAt = 0

/* ---------------- NAS ---------------- */

export const getNasSession = () => nas

export const patchNasSession = (patch: Partial<NasSession>) => {
  nas = { ...nas, ...patch, savedAt: Date.now() }
}

/** 写入磁盘；items 过大时降级只存目录位置 */
export const persistNasSession = () => {
  nas.savedAt = Date.now()
  const snapshot = { ...nas }
  void saveData(NAS_KEY, snapshot).catch(() => {
    // 存不下（歌最多时 JSON 可能几 MB）→ 只存位置，返回时自动重读该目录
    const light: NasSession = { ...snapshot, items: [], total: 0 }
    void saveData(NAS_KEY, light).catch(() => {})
  })
}

export const restoreNasSession = async(): Promise<NasSession> => {
  if (nas.host || nas.items.length) return nas
  try {
    const saved = await getData<NasSession>(NAS_KEY)
    if (saved?.host) nas = { ...nas, ...saved }
  } catch {}
  return nas
}

/** 所有已知的 NAS 曲目（当前目录 + 之后加载的分页） */
export const getNasItems = (): NasItem[] => nas.items

/* ---------------- NAS 可达性 ---------------- */

let nasProbeAt = 0
let nasProbeOk = false
/** 最近一次探测成功的时刻：单次超时不该把整块 NAS 曲目判成掉线（刷新时列表会突然清空） */
let nasOkAt = 0

/**
 * NAS 是否可达（离开家/断网时用来把 NAS 曲目排除在歌单外）
 * 结果缓存 30 秒；探测本身 1.5 秒超时
 */
export const isNasReachable = async(force = false, timeoutMs = 1500): Promise<boolean> => {
  // 冷启动时内存里还没有会话，必须先从磁盘恢复 host，否则下面会直接判"不可达"，
  // 表现为「开 App 第一次进音乐库看不到 NAS，再进一次就正常」
  if (!nas.host) await restoreNasSession()
  if (!nas.host) return false
  if (!force && nasProbeAt && Date.now() - nasProbeAt < 30000) return nasProbeOk

  const probe = async(ms: number): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let ctrl: AbortController | null = null
    try {
      // 用设备描述文件探活：`/` 在 QNAP 上返回 404（虽然也能判通，但响应体带 Content-Length + close，
      // 实测偶发读失败），rootDesc.xml 稳定返回 200
      const url = `http://${nas.host}/rootDesc.xml`
      ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
      const req = ctrl ? fetch(url, { method: 'GET', signal: ctrl.signal }) : fetch(url, { method: 'GET' })
      // 双重兜底：AbortController 不可用时靠 Promise.race 也能按时返回
      const guard = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try { ctrl?.abort() } catch {}
          reject(new Error('nas probe timeout'))
        }, ms)
      })
      const resp = await Promise.race([req, guard])
      return (resp?.status ?? 0) > 0
    } catch {
      return false
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  nasProbeOk = await probe(timeoutMs)
  // 冷启动时 JS 线程正忙着初始化，1.5 秒很容易被拖成"超时"→ 误判离线，
  // 表现为"开 App 第一次进音乐库看不到 NAS，再进一次就有了"。失败后补探一次，超时放宽
  if (!nasProbeOk) nasProbeOk = await probe(Math.max(timeoutMs * 2, 3000))
  nasProbeAt = Date.now()
  if (nasProbeOk) {
    nasOkAt = nasProbeAt
  } else if (nasOkAt && nasProbeAt - nasOkAt < 5 * 60 * 1000) {
    // 5 分钟内刚探通过：这次只是抖动/超时，不要因此把 NAS 曲目整块从列表里摘掉
    nasProbeOk = true
  }
  return nasProbeOk
}

/** 播放失败时立刻把 NAS 标记为不可达，下一次进歌单直接走离线逻辑 */
export const markNasUnreachable = () => {
  nasProbeAt = Date.now()
  nasProbeOk = false
}

/* ---------------- 本机音乐 ---------------- */

export const getLocalFiles = (): LocalAudioFile[] => localFiles

export const getLocalScannedAt = () => localScannedAt

export const setLocalFiles = (files: LocalAudioFile[]) => {
  localFiles = files
  localScannedAt = Date.now()
  void saveData(LOCAL_KEY, files).catch(() => {})
  void saveData(LOCAL_META_KEY, localScannedAt).catch(() => {})
}

/**
 * 旧扫描缓存没有 picUrl 字段（b127 之前扫的）→ 需要补扫一次
 * 判据：曲库非空，但没有一首带封面地址
 */
export const isLocalCoverStale = (): boolean => {
  // b189 起本机封面改为按需从音频文件内嵌抽取（MediaStore 的 albumart 地址在
  // Android 10+ 已废弃），所以「缓存里没有 picUrl」不再等于过期；
  // 只有「有歌但从未记录过扫描时间」的极老缓存才补扫一次，避免每次进页面都全盘重扫。
  if (!localFiles.length) return false
  return localScannedAt === 0
}

/**
 * 重新扫描本机曲库（只为拿封面，纯本地操作，不需要网络）
 * 返回是否真的刷新成功
 */
export const refreshLocalFiles = async(): Promise<boolean> => {
  try {
    const perm = await requestMediaPermission()
    if (!perm.granted) return false
    const files = await queryAudioFiles()
    if (!Array.isArray(files) || !files.length) return false
    // 保留扫描到的封面字段；如果这次还是拿不到封面就不要再反复扫
    setLocalFiles(files)
    return files.some(f => !!f.picUrl)
  } catch {
    return false
  }
}

export const restoreLocalFiles = async(): Promise<LocalAudioFile[]> => {
  if (localFiles.length) return localFiles
  try {
    const [files, at] = await Promise.all([
      getData<LocalAudioFile[]>(LOCAL_KEY),
      getData<number>(LOCAL_META_KEY),
    ])
    if (Array.isArray(files) && files.length) localFiles = files
    if (typeof at == 'number') localScannedAt = at
  } catch {}
  return localFiles
}

/* ---------------- NAS 全库索引 ---------------- */

let nasIndex: NasIndex | null = null

export const getNasIndex = () => nasIndex

export const setNasIndex = (idx: NasIndex | null) => {
  nasIndex = idx
  if (!idx) return
  // 封面哈希登记给 getCover：命中缩略图就不用再走网络
  try {
    for (const song of idx.songs) {
      if (song.coverHash) setCoverHash(song.url, song.coverHash)
    }
  } catch {}
  void saveData(INDEX_KEY, idx).catch(() => {
    // 索引太大存不下 → 只留内存，下次连接重建
  })
  // 通知「音乐库」之类的只读视图刷新（它不会自己轮询）
  try {
    global.state_event.mxNasIndexUpdated(idx.songs.length)
  } catch {}
}

/** 启动时预热：提前把 NAS 索引（可能几 MB JSON）读进内存 */
export const preloadNasIndex = () => { void restoreNasIndex().catch(() => {}) }

export const restoreNasIndex = async(): Promise<NasIndex | null> => {
  if (nasIndex) return nasIndex
  try {
    const saved = await getData<NasIndex>(INDEX_KEY)
    if (saved?.songs?.length) nasIndex = saved
  } catch {}
  return nasIndex
}

/* ---------------- 播放列表同步标记 ---------------- */

export const getPlaylistsSync = async() => {
  if (!playlistsSyncedLoaded) {
    playlistsSyncedLoaded = true
    try {
      const saved = await getData<{ host: string, at: number }>(PLAYLISTS_SYNCED_KEY)
      if (saved?.host) playlistsSynced = saved
    } catch {}
  }
  return playlistsSynced
}

export const markPlaylistsSynced = (host: string) => {
  playlistsSynced = { host, at: Date.now() }
  void saveData(PLAYLISTS_SYNCED_KEY, playlistsSynced).catch(() => {})
}
