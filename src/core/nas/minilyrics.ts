/**
 * MiniLyrics（Crintsoft）歌词源：逆向自 MiniLyrics / foobar 组件的搜索协议
 *
 * 协议要点（已实测通过）：
 *   1. POST http://search.crintsoft.com/searchlyrics.htm
 *      体 = \x02 key \x04\x00\x00\x00 md5(xml + "Mlv1clt4.0") xor(xml, key)
 *      key = round(平均字节值)；md5 服务器会校验，错了直接 400
 *   2. 响应同样是 XOR 编码，头部 22 字节后是 "MBXML1" 二进制（字典压缩），
 *      这里不解字典，只用正则抓里面的 *.lrc 链接（链接是纯 ASCII）
 *   3. 歌词文件是明文 UTF-8 LRC（带 BOM），[ti]/[ar]/[al] 头就是候选列表要显示的字段
 *
 * ⚠️ md5 必须按「UTF-8 字节」算。用 stringMd5() 时，非 ASCII 字符（中文歌名）
 *    在某些实现里是按 charCode&0xFF 压字节，算出的 md5 不对，服务器返回 400 —— 
 *    这正是 b137 上「MiniLyrics 一条都不出」的原因。所以这里统一用 binaryMd5(ArrayBuffer)。
 */

import { NativeModules } from 'react-native'
import { binaryMd5 } from 'react-native-quick-md5'

const SEARCH_URL = 'http://search.crintsoft.com/searchlyrics.htm'
const FILE_BASE = 'http://search.crintsoft.com/l/'
const WATERMARK = 'Mlv1clt4.0'
const LINK_RXP = /(?:ll|lu\d?|l)\/[ -~]{1,80}\.lrc/g
const TIMEOUT = 15000

/** 原生二进制通道（MiniLyricsModule.java）；RN 的 fetch/XHR 发二进制在部分机型直接 network error */
const ML_NATIVE: { post?: (url: string, bodyBase64: string) => Promise<string> } | undefined = (NativeModules as any).MiniLyrics

/** 最近一次失败原因（给界面显示，方便真机排查） */
let lastError = ''
let lastTransport = ''
export const getMiniLyricsError = () => lastError
export const getMiniLyricsTransport = () => lastTransport

const B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const bytesToBase64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1
    out += B64CHARS[b0 >> 2]
    out += B64CHARS[((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4)]
    out += b1 < 0 ? '=' : B64CHARS[((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6)]
    out += b2 < 0 ? '=' : B64CHARS[b2 & 63]
  }
  return out
}

const base64ToBytes = (str: string): Uint8Array => {
  const clean = str.replace(/[^A-Za-z0-9+/]/g, '')
  const out: number[] = []
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = B64CHARS.indexOf(clean[i])
    const c2 = B64CHARS.indexOf(clean[i + 1])
    const c3 = B64CHARS.indexOf(clean[i + 2])
    const c4 = B64CHARS.indexOf(clean[i + 3])
    if (c1 < 0 || c2 < 0) break
    out.push((c1 << 2) | (c2 >> 4))
    if (c3 >= 0) out.push(((c2 & 15) << 4) | (c3 >> 2))
    if (c4 >= 0) out.push(((c3 & 3) << 6) | c4)
  }
  return new Uint8Array(out)
}

const utf8Decode = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++]
    if (b < 0x80) out += String.fromCharCode(b)
    else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f))
    else if (b < 0xf0) out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f))
    else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
      out += String.fromCodePoint(cp)
    }
  }
  return out
}

const utf8 = (s: string): Uint8Array => {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = s.charCodeAt(++i)
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  return new Uint8Array(out)
}

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16) || 0
  return out
}

/** 按协议把搜索 XML 编码成二进制请求体（md5 按字节算） */
const encodeQuery = (xml: string): Uint8Array => {
  const data = utf8(xml)
  const wm = utf8(WATERMARK)
  const merged = new Uint8Array(data.length + wm.length)
  merged.set(data, 0)
  merged.set(wm, data.length)
  const md5 = hexToBytes(binaryMd5(merged.buffer))

  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i]
  const key = Math.round(sum / data.length) & 0xff

  const out = new Uint8Array(22 + data.length)
  out[0] = 0x02
  out[1] = key
  out[2] = 0x04
  out[3] = 0
  out[4] = 0
  out[5] = 0
  out.set(md5, 6)
  for (let i = 0; i < data.length; i++) out[22 + i] = data[i] ^ key
  return out
}

const requestXhr = (body: Uint8Array): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest()
  try {
    xhr.open('POST', SEARCH_URL)
    xhr.responseType = 'arraybuffer'
    xhr.timeout = TIMEOUT
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const buf = xhr.response as ArrayBuffer
        if (!buf || !buf.byteLength) {
          reject(new Error('响应为空'))
          return
        }
        resolve(new Uint8Array(buf))
      } else reject(new Error(`HTTP ${xhr.status}`))
    }
    xhr.onerror = () => { reject(new Error('网络错误（明文 http 或 DNS）')) }
    xhr.ontimeout = () => { reject(new Error('超时')) }
    xhr.send(body.buffer as ArrayBuffer)
  } catch (e) {
    reject(e as Error)
  }
})

/** 兜底：万一 XHR 发不了二进制，用 fetch 再试一次 */
const requestFetch = async(body: Uint8Array): Promise<Uint8Array> => {
  const resp = await fetch(SEARCH_URL, { method: 'POST', body })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const buf = await resp.arrayBuffer()
  if (!buf.byteLength) throw new Error('响应为空')
  return new Uint8Array(buf)
}

/** 原生通道：把字节走 Java 的 HttpURLConnection 发出去 */
const requestNative = async(body: Uint8Array): Promise<Uint8Array> => {
  if (!ML_NATIVE?.post) throw new Error('原生通道不可用')
  const b64 = await ML_NATIVE.post(SEARCH_URL, bytesToBase64(body))
  return base64ToBytes(String(b64 ?? ''))
}

const postBinary = async(body: Uint8Array): Promise<Uint8Array> => {
  const errors: string[] = []
  try {
    const res = await requestNative(body)
    if (res.length) {
      lastError = ''
      lastTransport = 'native'
      return res
    }
    errors.push('native: 空响应')
  } catch (e) {
    errors.push(`native: ${(e as Error)?.message ?? e}`)
  }
  try {
    const res = await requestXhr(body)
    lastError = ''
    lastTransport = 'xhr'
    return res
  } catch (e) {
    errors.push(`xhr: ${(e as Error)?.message ?? e}`)
  }
  try {
    const res = await requestFetch(body)
    lastError = ''
    lastTransport = 'fetch'
    return res
  } catch (e) {
    errors.push(`fetch: ${(e as Error)?.message ?? e}`)
  }
  lastError = errors.join(' / ')
  throw new Error(lastError)
}

const escXml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** 搜候选：返回歌词文件链接（相对路径，形如 lu/y1/jg_zlcvncqs.lrc） */
export const searchMiniLyricsLinks = async(artist: string, title: string): Promise<string[]> => {
  if (!title.trim()) return []
  const xml = "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>"
    + `<searchV1 client="MiniLyrics" artist="${escXml(artist.trim())}" title="${escXml(title.trim())}" OnlyMatched="1" />`
  const resp = await postBinary(encodeQuery(xml))
  if (resp.length < 23) {
    lastError = '响应过短'
    return []
  }
  const key = resp[1]
  // 只关心 ASCII 部分：非 ASCII 字节换成占位符，链接会在占位符处自然断开
  let text = ''
  for (let i = 22; i < resp.length; i++) {
    const b = resp[i] ^ key
    text += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '\u0001'
  }
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  LINK_RXP.lastIndex = 0
  while ((m = LINK_RXP.exec(text)) != null) {
    if (seen.has(m[0])) continue
    seen.add(m[0])
    out.push(m[0])
  }
  return out
}

/** 取一条歌词（明文 UTF-8 LRC）：先走 fetch，失败再走原生通道 */
export const fetchMiniLyrics = async(link: string): Promise<string> => {
  const url = FILE_BASE + link.replace(/^\/+/, '')
  try {
    const resp = await fetch(url)
    if (resp.ok) {
      let txt = await resp.text()
      if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1)
      return txt.trim()
    }
    throw new Error(`HTTP ${resp.status}`)
  } catch (e) {
    const nat = ML_NATIVE as any
    if (!nat?.get) throw e
    const b64 = await nat.get(url)
    let txt = utf8Decode(base64ToBytes(String(b64 ?? '')))
    if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1)
    return txt.trim()
  }
}

/** 读 LRC 头里的 [ti]/[ar]/[al] */
export const parseMiniLyricsMeta = (lrc: string): { title: string, artist: string, album: string } => {
  const pick = (k: string) => {
    const m = new RegExp(`^\\[${k}:(.*?)\\]`, 'm').exec(lrc)
    return m ? m[1].trim() : ''
  }
  return { title: pick('ti'), artist: pick('ar'), album: pick('al') }
}

/**
 * 自检：区分「网络/明文 http 不通」和「POST 二进制发不出去」
 *  1. 纯 GET 取一个已知歌词文件（https 通不通、明文白名单有没有生效）
 *  2. 纯 ASCII 标题的 POST 搜索（绕开中文编码，只看二进制请求能不能发）
 */
export const diagnoseMiniLyrics = async(): Promise<string> => {
  const parts: string[] = []
  parts.push(ML_NATIVE?.post ? '原生通道:有' : '原生通道:无')
  const t0 = Date.now()
  try {
    const resp = await fetch(FILE_BASE + 'll/0/kd_scqwqs.lrc')
    parts.push(`GET ${resp.ok ? 'ok' : 'HTTP ' + resp.status} ${Date.now() - t0}ms`)
  } catch (e: any) {
    parts.push(`GET 失败(${Date.now() - t0}ms): ${e?.message ?? e}`)
  }
  const t1 = Date.now()
  try {
    const links = await searchMiniLyricsLinks('', 'qingtian')
    parts.push(`POST(ASCII) ${links.length} 条 ${Date.now() - t1}ms via ${lastTransport || '-'}`)
  } catch (e: any) {
    parts.push(`POST(ASCII) 失败: ${e?.message ?? e}`)
  }
  return parts.join(' ｜ ')
}
