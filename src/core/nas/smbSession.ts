/**
 * SMB 验证态
 * 规则（用户定）：第一次连接验证一次，之后一直有效；卸载重装或清除账号才失效。
 * 因此落盘保存，并与「账号 + 主机」绑定，换账号会自动失效。
 */
import { getData, saveData } from '@/plugins/storage'

const KEY = '@mod_smb_verified'

export interface SmbVerifiedRec {
  host: string
  user: string
  at: number
}

let verified = false
let rec: SmbVerifiedRec | null = null

export const isSmbVerified = () => verified
export const getSmbVerifiedRec = () => rec

/** 读盘：与给定账号比对，一致才算已验证 */
export const loadSmbVerified = async(host?: string, user?: string): Promise<boolean> => {
  try {
    const saved = await getData<SmbVerifiedRec>(KEY)
    if (!saved?.user) {
      verified = false
      rec = null
      return false
    }
    rec = saved
    verified = (!host || saved.host == host) && (!user || saved.user == user)
    return verified
  } catch {
    verified = false
    return false
  }
}

/** 验证通过后落盘 */
export const markSmbVerified = async(host: string, user: string) => {
  verified = true
  rec = { host, user, at: Date.now() }
  await saveData(KEY, rec).catch(() => {})
}

/** 清除（换账号 / 验证失败 / 用户主动退出） */
export const clearSmbVerified = async() => {
  verified = false
  rec = null
  await saveData(KEY, {}).catch(() => {})
}
