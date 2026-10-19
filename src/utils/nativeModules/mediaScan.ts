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

/** SSDP 搜索局域网内的 DLNA 媒体服务器 */
export const discoverDlnaServers = async(timeoutMs = 3000): Promise<DlnaServer[]> => {
  if (!MediaScan) throw new Error('MediaScan 原生模块未加载')
  return await MediaScan.discoverDlna(timeoutMs)
}
