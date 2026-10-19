/**
 * 读取远程音频文件内嵌封面（NAS 场景）
 * 两段式 Range 请求：先取头部定位封面块，再精确取图片数据
 */
import { fromByteArray } from 'react-native-quick-base64'

const HEAD_BYTES = 512 * 1024
const MAX_ART_BYTES = 8 * 1024 * 1024

const u32 = (b: Uint8Array, o = 0) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
const syncsafe = (b: Uint8Array, o = 0) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)
const ascii = (b: Uint8Array, s: number, e: number) => {
  let out = ''
  for (let i = s; i < e && i < b.length; i++) out += String.fromCharCode(b[i])
  return out
}

const fetchRange = async(url: string, start: number, end: number): Promise<Uint8Array> => {
  const resp = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return new Uint8Array(await resp.arrayBuffer())
}

const toBase64 = (data: Uint8Array): string => fromByteArray(data)

interface ArtRef {
  mime: string
  /** 图片数据在文件中的绝对偏移 */
  offset: number
  length: number
}

/** 解析 FLAC 元数据块（type 6 = PICTURE） */
const findFlacArt = (buf: Uint8Array): ArtRef | null => {
  if (ascii(buf, 0, 4) !== 'fLaC') return null
  let off = 4
  while (off + 4 <= buf.length) {
    const header = buf[off]
    const last = (header & 0x80) !== 0
    const type = header & 0x7f
    const len = (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]
    const body = off + 4
    if (type === 6) {
      let p = body + 4 // picture type
      const mimeLen = u32(buf, p)
      p += 4
      const mime = ascii(buf, p, p + mimeLen) || 'image/jpeg'
      p += mimeLen
      const descLen = u32(buf, p)
      p += 4 + descLen + 16 // 描述 + 宽高深色
      const dataLen = u32(buf, p)
      p += 4
      if (dataLen > MAX_ART_BYTES) return null
      return { mime, offset: p, length: dataLen }
    }
    off = body + len
    if (last) break
  }
  return null
}

/** 解析 ID3v2 APIC（mp3） */
const findId3Art = (buf: Uint8Array): ArtRef | null => {
  if (ascii(buf, 0, 3) !== 'ID3') return null
  const ver = buf[3]
  const size = syncsafe(buf, 6)
  let off = 10
  const end = Math.min(buf.length, 10 + size)
  while (off + 10 <= end) {
    const id = ascii(buf, off, off + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const fsize = ver >= 4 ? syncsafe(buf, off + 4) : u32(buf, off + 4)
    const body = off + 10
    if (id === 'APIC' && fsize > 0) {
      let p = body + 1 // 编码
      let mEnd = p
      while (mEnd < body + fsize && buf[mEnd] !== 0) mEnd++
      const mime = ascii(buf, p, mEnd) || 'image/jpeg'
      p = mEnd + 2 // 跳过 null + picture type
      // 描述字符串按编码决定终止符
      const enc = buf[body]
      if (enc === 1 || enc === 2) {
        let q = p
        while (q + 1 < body + fsize && !(buf[q] === 0 && buf[q + 1] === 0)) q += 2
        p = q + 2
      } else {
        const z = buf.indexOf(0, p)
        p = z === -1 ? p : z + 1
      }
      const dataLen = Math.min(body + fsize - p, MAX_ART_BYTES)
      if (dataLen <= 0) return null
      return { mime, offset: p, length: dataLen }
    }
    off = body + fsize
  }
  return null
}

/**
 * 尝试读取远程文件的内嵌封面，返回 data:image/... 地址
 * 拿不到返回 null（调用方再走在线兜底）
 */
export const readRemoteArt = async(url: string): Promise<string | null> => {
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const head = await fetchRange(url, 0, HEAD_BYTES - 1)
    if (head.length < 12) return null
    const ref = findFlacArt(head) ?? findId3Art(head)
    if (!ref || ref.length <= 0) return null

    let data: Uint8Array
    if (ref.offset + ref.length <= head.length) {
      data = head.subarray(ref.offset, ref.offset + ref.length)
    } else {
      data = await fetchRange(url, ref.offset, ref.offset + ref.length - 1)
    }
    if (data.length < 512) return null
    return `data:${ref.mime};base64,${toBase64(data)}`
  } catch {
    return null
  }
}
