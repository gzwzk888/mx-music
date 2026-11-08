/**
 * 封面缩略图缓存（原生 CoverCache 模块的 JS 封装）
 *
 * 设计：
 *  - 逐张读取音频内嵌封面 → SHA-1 作为键 → 缩到 512px JPEG(q85) 落盘
 *  - 只认哈希去重：同一张图不论来自本机还是 NAS、在哪个目录，只存一份
 *  - 目录可配：私有 / 外部 Android/data / 用户自选（SAF，可指向 TF 卡）
 */
import { NativeModules } from 'react-native'

export const COVER_SIZE = 512
export const COVER_QUALITY = 85

export interface CoverDirInfo {
  kind: 'private' | 'external' | 'saf'
  dir: string
}

export interface ThumbResult {
  hash: string
  thumb: string | null
  artBytes: number
  thumbBytes?: number
  cached?: boolean
}

interface CoverCacheNative {
  getDir(): Promise<CoverDirInfo>
  setDir(kind: string, uri: string | null): Promise<string>
  pickDir(): Promise<string | null>
  thumbOf(hash: string): Promise<string | null>
  makeThumbFromFile(path: string, maxSize: number, quality: number, dryRun: boolean): Promise<ThumbResult | null>
  makeThumbFromBase64(b64: string, maxSize: number, quality: number, dryRun: boolean): Promise<ThumbResult | null>
  makeThumbFromImage(path: string, maxSize: number, quality: number, dryRun: boolean): Promise<ThumbResult | null>
  clearAll(): Promise<number>
  stats(): Promise<{ count: number, bytes: number, dir: string, kind: string }>
}

const native = (NativeModules as any).CoverCache as CoverCacheNative | undefined

export const isCoverCacheAvailable = () => !!native

/** 哈希 → 缩略图地址（null 表示没有）。内存缓存，避免反复跨线程查询 */
const thumbCache = new Map<string, string | null>()

export const getCoverDir = async(): Promise<CoverDirInfo> => {
  if (!native) return { kind: 'private', dir: '' }
  try { return await native.getDir() } catch { return { kind: 'private', dir: '' } }
}

export const setCoverDir = async(kind: 'private' | 'external' | 'saf', uri?: string | null): Promise<string> => {
  if (!native) return ''
  thumbCache.clear()
  const dir = await native.setDir(kind, uri ?? null)
  return dir
}

/** 弹系统目录选择器（SAF），返回选中的目录；取消返回 null */
export const pickCoverDir = async(): Promise<string | null> => {
  if (!native) return null
  thumbCache.clear()
  try { return await native.pickDir() } catch { return null }
}

export const thumbOf = async(hash?: string | null): Promise<string | null> => {
  if (!hash || !native) return null
  if (thumbCache.has(hash)) return thumbCache.get(hash)!
  let p: string | null = null
  try { p = await native.thumbOf(hash) } catch { p = null }
  thumbCache.set(hash, p)
  return p
}

/** 本机文件：抽内嵌封面并生成缩略图（dryRun 只算哈希不写盘） */
export const makeThumbFromFile = async(path: string, dryRun = false): Promise<ThumbResult | null> => {
  if (!native) return null
  try {
    const r = await native.makeThumbFromFile(path, COVER_SIZE, COVER_QUALITY, dryRun)
    if (r?.thumb) thumbCache.set(r.hash, r.thumb)
    return r
  } catch {
    return null
  }
}

/** NAS：传入已取到的图片 base64 / data URL */
export const makeThumbFromBase64 = async(b64: string, dryRun = false): Promise<ThumbResult | null> => {
  if (!native) return null
  try {
    const r = await native.makeThumbFromBase64(b64, COVER_SIZE, COVER_QUALITY, dryRun)
    if (r?.thumb) thumbCache.set(r.hash, r.thumb)
    return r
  } catch {
    return null
  }
}

export const clearCoverCache = async(): Promise<number> => {
  thumbCache.clear()
  if (!native) return 0
  try { return await native.clearAll() } catch { return 0 }
}

export const coverCacheStats = async(): Promise<{ count: number, bytes: number, dir: string, kind: string }> => {
  if (!native) return { count: 0, bytes: 0, dir: '', kind: 'private' }
  try { return await native.stats() } catch { return { count: 0, bytes: 0, dir: '', kind: 'private' } }
}

/** 目录变化后（切换保存位置）需要刷新内存映射 */
export const resetThumbMemCache = () => { thumbCache.clear() }

/** 同目录封面图片（cover.jpg 等）：直接以图片文件生成缩略图 */
export const makeThumbFromImage = async(path: string, dryRun = false): Promise<ThumbResult | null> => {
  if (!native) return null
  try {
    const r = await native.makeThumbFromImage(path, COVER_SIZE, COVER_QUALITY, dryRun)
    if (r?.thumb) thumbCache.set(r.hash, r.thumb)
    return r
  } catch {
    return null
  }
}
