/**
 * NAS / 本机音乐的会话与缓存
 *   - 内存态：切换菜单（组件被卸载）后仍保留
 *   - 磁盘态：App 重启后仍保留
 */

import { getData, saveData } from '@/plugins/storage'
import type { NasDevice, NasItem } from './dlna'
import { type LocalAudioFile, queryAudioFiles, requestMediaPermission } from '@/utils/nativeModules/mediaScan'
import type { NasIndex } from './nasIndex'

const NAS_KEY = '@mod_nas_session'
const LOCAL_KEY = '@mod_local_files'
const LOCAL_META_KEY = '@mod_local_scan_at'
const INDEX_KEY = '@mod_nas_index'

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

/**
 * NAS 是否可达（离开家/断网时用来把 NAS 曲目排除在歌单外）
 * 结果缓存 30 秒；探测本身 1.5 秒超时
 */
export const isNasReachable = async(force = false, timeoutMs = 1500): Promise<boolean> => {
  if (!nas.host) return false
  if (!force && nasProbeAt && Date.now() - nasProbeAt < 30000) return nasProbeOk

  let timer: ReturnType<typeof setTimeout> | null = null
  let ctrl: AbortController | null = null
  try {
    // 与 DLNA 探测同一个根地址：能连上就认为在家里的局域网
    const url = `http://${nas.host}/`
    ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const req = ctrl ? fetch(url, { method: 'GET', signal: ctrl.signal }) : fetch(url, { method: 'GET' })
    // 双重兜底：AbortController 不可用时靠 Promise.race 也能按时返回
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        try { ctrl?.abort() } catch {}
        reject(new Error('nas probe timeout'))
      }, timeoutMs)
    })
    const resp = await Promise.race([req, guard])
    nasProbeOk = (resp?.status ?? 0) > 0
  } catch {
    nasProbeOk = false
  } finally {
    if (timer) clearTimeout(timer)
  }
  nasProbeAt = Date.now()
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
  if (localFiles.length < 3) return false
  for (const f of localFiles) {
    if (f.picUrl) return false
  }
  return true
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
  void saveData(INDEX_KEY, idx).catch(() => {
    // 索引太大存不下 → 只留内存，下次连接重建
  })
}

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
