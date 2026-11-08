/**
 * 读取远程音频文件内嵌封面（NAS 场景）
 * 两段式 Range 请求：先取头部定位封面块，再精确取图片数据
 */
import { fromByteArray } from 'react-native-quick-base64'

const HEAD_BYTES = 512 * 1024
/** WAV 的 ID3 标签盖在文件末尾；写标签的工具通常接在 data chunk 之后，按头部算出的位置直接去读。
 *  窗口取 256KB：常见封面几十到两百 KB，够用；窗口越大，每首多传的字节越多。 */
const TAIL_BYTES = 256 * 1024
/** data 之后最多允许读这么多（防止某些文件 data 后面还有大块数据时读爆） */
const TAIL_HARD_LIMIT = 32 * 1024 * 1024
const MAX_ART_BYTES = 8 * 1024 * 1024

const u32 = (b: Uint8Array, o = 0) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
const syncsafe = (b: Uint8Array, o = 0) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)
const ascii = (b: Uint8Array, s: number, e: number) => {
  let out = ''
  for (let i = s; i < e && i < b.length; i++) out += String.fromCharCode(b[i])
  return out
}

const fetchRange = async(url: string, start: number, end: number): Promise<Uint8Array> => {
  // QNAP 每次响应后主动断连：复用 keep-alive 连接会拿到空响应，
  // 所以这里必须重试（否则封面扫描会大批误判「没有封面」）。
  const want = end - start + 1
  let lastErr: any = null
  for (let i = 0; i < 4; i++) {
    try {
      const resp = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}`, Connection: 'close' },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const buf = await resp.arrayBuffer()
      if (buf.byteLength > 0) return new Uint8Array(buf)
      lastErr = new Error('empty body')
    } catch (e) {
      lastErr = e
    }
    await new Promise(r => setTimeout(r, 120 * (i + 1)))
  }
  throw lastErr ?? new Error('range failed')
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
 * WAV（RIFF）里的 id3 chunk：写标签的工具通常把它追加在文件末尾，
 * 头部 512KB 里读不到 → 先从头部按 chunk 走一遍，再取尾部一段倒着找。
 */
const isRiffWav = (buf: Uint8Array) => ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WAVE'

/** 在头部缓冲里按 RIFF chunk 顺序找 `id3 `（遇到 data 就停，避免走进音频数据） */
const findWavHeadArt = (buf: Uint8Array): ArtRef | null => {
  if (!isRiffWav(buf)) return null
  let off = 12
  while (off + 8 <= buf.length) {
    const id = ascii(buf, off, off + 4)
    const len = (buf[off + 4] | (buf[off + 5] << 8) | (buf[off + 6] << 16) | (buf[off + 7] << 24)) >>> 0
    const body = off + 8
    if (id === 'id3 ' || id === 'ID3 ') {
      if (len < 11 || len > MAX_ART_BYTES * 2 || body + len > buf.length) return null
      const ref = findId3Art(buf.subarray(body, body + len))
      return ref ? { mime: ref.mime, offset: body + ref.offset, length: ref.length } : null
    }
    if (id === 'data') return null
    off = body + len + (len & 1)
  }
  return null
}

/** 头部解析出 data chunk 的结束位置（绝对偏移）；解析不出或 size 字段不可信返回 0 */
const dataEnd = (buf: Uint8Array): number => {
  if (!isRiffWav(buf)) return 0
  let off = 12
  while (off + 8 <= buf.length) {
    const id = ascii(buf, off, off + 4)
    const len = (buf[off + 4] | (buf[off + 5] << 8) | (buf[off + 6] << 16) | (buf[off + 7] << 24)) >>> 0
    if (id === 'data') {
      if (len === 0 || len === 0xffffffff) return 0
      return off + 8 + len + (len & 1)
    }
    off = off + 8 + len + (len & 1)
  }
  return 0
}

/**
 * 从尾部缓冲里倒着找 `id3 ` + ID3v2 头。
 * 尾部缓冲的起点是随机的（可能落在某个 chunk 中间），所以不按 chunk 走，直接找标记并校验结构。
 */
const findWavTailArt = (buf: Uint8Array, base: number): ArtRef | null => {
  for (let i = buf.length - 8; i >= 0; i--) {
    if (buf[i] !== 0x69 || buf[i + 1] !== 0x64 || buf[i + 2] !== 0x33 || buf[i + 3] !== 0x20) continue // 'id3 '
    const len = (buf[i + 4] | (buf[i + 5] << 8) | (buf[i + 6] << 16) | (buf[i + 7] << 24)) >>> 0
    if (len < 11 || len > MAX_ART_BYTES * 2 || i + 8 + len > buf.length) continue
    const ref = findId3Art(buf.subarray(i + 8, i + 8 + len))
    if (!ref) continue
    return { mime: ref.mime, offset: base + i + 8 + ref.offset, length: ref.length }
  }
  return null
}

/** 文件总长度：走 HEAD，拿不到就返回 0（本轮只用来定位尾部） */
const remoteSize = async(url: string): Promise<number> => {
  try {
    const resp = await fetch(url, { method: 'HEAD' })
    if (!resp.ok) return 0
    const n = Number(resp.headers.get('content-length') || 0)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/**
 * 尝试读取远程文件的内嵌封面，返回 data:image/... 地址
 * 拿不到返回 null（调用方再走在线兜底）
 */
export const readRemoteArt = async(url: string): Promise<string | null> => {
  if (!/^https?:\/\//i.test(url)) return null
  // 注意：网络失败要往上抛，不能当成「没有封面」——否则会被永久标记成无封面
  {
    // 一次读 64KB 头部就能覆盖绝大多数情况：判格式、定位封面、甚至直接取到图片数据。
    // 原先「先探 16KB 再读 512KB」等于白跑一次往返。只有标签特别大的文件才补读完整头部。
    let ref: ArtRef | null = null
    let loaded: Uint8Array | null = null
    let loadedBase = 0

    const head = await fetchRange(url, 0, 65535)
    if (head.length < 12) return null
    loaded = head
    loadedBase = 0

    if (isRiffWav(head)) {
      // WAV 的封面在 data 之后（多在文件尾部）。
      // 注意：QNAP 的 DLNA 不支持 suffix range（bytes=-N 返回 400），所以只能
      // 先 HEAD 问大小，再按 data chunk 的结束位置精确读尾部。
      ref = findWavHeadArt(head)
      if (!ref) {
        const size = await remoteSize(url)
        if (size > head.length) {
          const de = dataEnd(head)
          let start = Math.max(0, size - TAIL_BYTES)
          if (de > 0 && de < size && size - de <= TAIL_HARD_LIMIT) start = de
          if (size - start >= 11) {
            const tail = await fetchRange(url, start, size - 1)
            if (tail.length >= 11) {
              ref = findWavTailArt(tail, start)
              if (ref) { loaded = tail; loadedBase = start }
            }
          }
        }
      }
    }

    // FLAC（图块在头部）/ mp3 等（ID3v2 在头部）
    if (!ref) ref = findFlacArt(head) ?? findId3Art(head)

    // 64KB 里没找到：可能是 ID3 标签很大（封面帧在更后面），补读完整头部再试一次
    if (!ref && !isRiffWav(head)) {
      const big = await fetchRange(url, 0, HEAD_BYTES - 1)
      if (big.length > head.length) {
        loaded = big
        loadedBase = 0
        ref = findFlacArt(big) ?? findId3Art(big)
      }
    }

    if (!ref || ref.length <= 0) return null

    let data: Uint8Array
    if (loaded && ref.offset >= loadedBase && ref.offset + ref.length <= loadedBase + loaded.length) {
      const s = ref.offset - loadedBase
      // 必须用 slice（复制、偏移归零）而不是 subarray（视图、保留 offset）：
      // 转 base64 的原生模块按底层 buffer 起点读，不认视图偏移，否则取到的是文件头垃圾数据
      data = loaded.slice(s, s + ref.length)
    } else {
      data = await fetchRange(url, ref.offset, ref.offset + ref.length - 1)
    }
    if (data.length < 512) return null
    return `data:${ref.mime};base64,${toBase64(data)}`
  }
}
