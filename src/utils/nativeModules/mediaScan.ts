import { NativeModules, PermissionsAndroid, Platform } from 'react-native'

const { MediaScan } = NativeModules

export interface LocalAudioFile {
  path: string
  title: string | null
  artist: string | null
  album: string | null
  /** 毫秒 */
  duration: number
  size: number
  mimeType: string | null
  fileName: string | null
  /** 歌曲封面：MediaStore 的 content:// 专辑图地址，无则 null */
  picUrl?: string | null
}

/** 原生模块是否可用（用于界面自检） */
export const hasMediaScanModule = (): boolean => !!MediaScan

export const androidVersion = (): number => Platform.OS === 'android' ? (Platform.Version as number) : 0

/** 申请读取音频权限：targetSdk 29 → 旧权限模型；Android 13+ 再补试 READ_MEDIA_AUDIO */
export const requestMediaPermission = async(): Promise<{ granted: boolean, detail: string }> => {
  if (Platform.OS !== 'android') return { granted: false, detail: '非 Android' }
  const tried: string[] = []
  try {
    const perms: string[] = [PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE as string]
    if (androidVersion() >= 33) perms.push((PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_AUDIO ?? 'android.permission.READ_MEDIA_AUDIO')
    for (const perm of perms) {
      try {
        const res = await PermissionsAndroid.request(perm as any)
        tried.push(`${perm.split('.').pop()}=${res}`)
        if (res === PermissionsAndroid.RESULTS.GRANTED) return { granted: true, detail: tried.join(' ') }
      } catch (e: any) {
        tried.push(`${perm.split('.').pop()}=异常(${e?.message ?? e})`)
      }
    }
    return { granted: false, detail: tried.join(' ') || '未发起请求' }
  } catch (e: any) {
    return { granted: false, detail: `申请异常：${e?.message ?? e}` }
  }
}

/** 查询手机上的全部音频文件 */
export const queryAudioFiles = async(): Promise<LocalAudioFile[]> => {
  if (!MediaScan) throw new Error('MediaScan 原生模块未加载')
  return await MediaScan.queryAudio()
}

export interface DlnaServer {
  location: string
  server: string | null
  usn: string | null
  ip: string | null
}

/**
 * 选一张本地图片（系统文件选择器），复制到应用私有目录后返回 file:// 路径。
 * 用户取消返回 null。
 */
export const pickImageFile = async(): Promise<string | null> => {
  if (!MediaScan) throw new Error('MediaScan 原生模块未加载')
  try {
    return await MediaScan.pickImage()
  } catch (e: any) {
    if (`${e?.code ?? ''}`.includes('cancel') || `${e?.message ?? ''}`.includes('取消')) return null
    throw e
  }
}

/** SSDP 搜索局域网内的 DLNA 媒体服务器 */
export const discoverDlnaServers = async(timeoutMs = 3000): Promise<DlnaServer[]> => {
  if (!MediaScan) throw new Error('MediaScan 原生模块未加载')
  return await MediaScan.discoverDlna(timeoutMs)
}

/* ==================== 指定目录扫描（本机音乐） ==================== */

export interface ScannedAudioFile {
  path: string
  name: string
  size: number
  mtime: number
  dup?: boolean
}

/** 音频规格：采样率（Hz）/ 位深（bit）/ 码率（bps） */
export interface AudioSpec {
  sampleRate: number
  bits: number
  bitrate: number
}

/** 读取音频规格（本机文件）：FLAC / WAV 走文件头解析，其余退回系统元数据 */
export const readAudioSpec = async(path: string): Promise<AudioSpec | null> => {
  if (!MediaScan?.readAudioSpec) return null
  try {
    return await MediaScan.readAudioSpec(path)
  } catch {
    return null
  }
}

export interface AudioTags {
  title: string | null
  artist: string | null
  album: string | null
  /** 风格标签（FLAC/MP3 通常有，WAV 可能为空） */
  genre?: string | null
  /** 是否有封面：内嵌图，或同目录有 cover/folder/front 之类图片 */
  hasCover?: boolean
  /** 毫秒 */
  duration: number
}

/** 是否已有「所有文件访问」权限（Android 11+） */
export const hasAllFilesAccess = async(): Promise<boolean> => {
  if (!MediaScan?.hasAllFilesAccess) return false
  try {
    return await MediaScan.hasAllFilesAccess()
  } catch {
    return false
  }
}

/** 跳系统授权页 */
export const openAllFilesSettings = async(): Promise<void> => {
  if (!MediaScan?.openAllFilesSettings) return
  try {
    await MediaScan.openAllFilesSettings()
  } catch {}
}

/** 递归扫描若干目录下的音频文件（只列清单，不读标签） */
export const scanAudioDirs = async(dirs: string[]): Promise<ScannedAudioFile[]> => {
  if (!MediaScan?.scanAudioDirs) throw new Error('MediaScan 原生模块未加载')
  return await MediaScan.scanAudioDirs(dirs)
}

/** 读单个文件的标签 */
export const readAudioTags = async(path: string): Promise<AudioTags | null> => {
  if (!MediaScan?.readTags) return null
  try {
    return await MediaScan.readTags(path)
  } catch {
    return null
  }
}

/** 抽内嵌封面到缓存目录，返回可直接给 <Image> 用的 file:// 地址 */
export const readEmbeddedCover = async(path: string): Promise<string | null> => {
  if (!MediaScan?.readCover) return null
  try {
    const p = await MediaScan.readCover(path)
    if (!p) return null
    // 原生返回的是绝对路径，RN 的 Image 要 file:// 前缀才认
    return p.startsWith('/') ? `file://${p}` : p
  } catch {
    return null
  }
}
