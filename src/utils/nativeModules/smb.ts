/**
 * SMB 登录信息与读取（用于拿 NAS 上的 .cue 等 DLNA 看不到的文件）
 */

import { NativeModules } from 'react-native'
import { getData, saveData } from '@/plugins/storage'

const CREDS_KEY = '@mod_smb_creds'

export interface SmbCreds {
  host: string
  share: string
  user: string
  pass: string
  /** 自检后确定的协议模式：SMB2 / SMB2-only / SMB1 */
  mode?: string
}

export interface SmbFileEntry {
  name: string
  dir: boolean
  size: number
}

export interface SmbProbeResult {
  ok: boolean
  mode?: string
  count?: number
  errors?: Array<{ mode: string, error: string }>
}

let cached: SmbCreds | null = null

const mod = (NativeModules as any).SmbModule as {
  list: (host: string, share: string, path: string, user: string, pass: string, mode: string) => Promise<SmbFileEntry[]>
  readText: (host: string, share: string, path: string, user: string, pass: string, mode: string) => Promise<string>
  probe: (host: string, share: string, user: string, pass: string) => Promise<SmbProbeResult>
  resetCache?: () => Promise<boolean>
} | undefined

export const hasSmb = () => !!mod

export const loadSmbCreds = async(): Promise<SmbCreds | null> => {
  if (cached) return cached.user ? cached : null
  try {
    const saved = await getData<SmbCreds>(CREDS_KEY)
    if (saved?.host && saved?.user) cached = saved
  } catch {}
  return cached?.user ? cached : null
}

export const saveSmbCreds = async(creds: SmbCreds | null) => {
  cached = creds
  await saveData(CREDS_KEY, creds ?? {}).catch(() => {})
}

export const clearSmbCreds = async() => {
  cached = null
  await mod?.resetCache?.().catch(() => {})
  await saveData(CREDS_KEY, {}).catch(() => {})
}

/** 换账号/密码后清掉原生侧缓存的会话 */
export const resetSmbCache = () => {
  if (!mod?.resetCache) return
  void mod.resetCache().catch(() => {})
}

/** 列目录；失败抛错 */
export const smbProbe = async(creds: SmbCreds): Promise<SmbProbeResult> => {
  if (!mod) return { ok: false, errors: [{ mode: 'module', error: 'SMB 模块未加载' }] }
  return mod.probe(creds.host, creds.share, creds.user, creds.pass)
}

export const smbList = async(creds: SmbCreds, path: string): Promise<SmbFileEntry[]> => {
  if (!mod) throw new Error('SMB 模块未加载')
  return mod.list(creds.host, creds.share, path, creds.user, creds.pass, creds.mode ?? 'SMB2')
}

/** 读文本；失败抛错 */
export const smbReadText = async(creds: SmbCreds, path: string): Promise<string> => {
  if (!mod) throw new Error('SMB 模块未加载')
  return mod.readText(creds.host, creds.share, path, creds.user, creds.pass, creds.mode ?? 'SMB2')
}
