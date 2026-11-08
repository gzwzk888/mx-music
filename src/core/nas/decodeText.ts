/**
 * 文本解码：NAS 的 DLNA 服务（QNAP / MiniDLNA / ReadyMedia 等）返回中文时，
 * 常见两种坑：
 *   1. 响应头声明 charset=ISO-8859-1，但正文其实是 GBK 字节
 *   2. 干脆不声明，客户端按 UTF-8 解 → 要么替换成「」，要么解成 ÊýÒu 这种乱码
 * 所以不能直接用 resp.text()，要拿原始字节自己判编码。
 */

import { GBK_TABLE } from './gbkTable'

const REPLACEMENT = '\ufffd'

/** 严格校验 UTF-8：任何非法序列都返回 false */
export const isValidUtf8 = (bytes: Uint8Array): boolean => {
  let i = 0
  const len = bytes.length
  while (i < len) {
    const c = bytes[i]
    if (c < 0x80) { i++; continue }
    let n: number
    if (c >= 0xC2 && c <= 0xDF) n = 1
    else if (c >= 0xE0 && c <= 0xEF) n = 2
    else if (c >= 0xF0 && c <= 0xF4) n = 3
    else return false
    if (i + n >= len) return false
    for (let k = 1; k <= n; k++) {
      const cc = bytes[i + k]
      if (cc < 0x80 || cc > 0xBF) return false
    }
    i += n + 1
  }
  return true
}

const decodeUtf8 = (bytes: Uint8Array): string => {
  try {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes)
  } catch {}
  // 兜底：手写 UTF-8 解码
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const c = bytes[i]
    if (c < 0x80) { out += String.fromCharCode(c); i++; continue }
    let n = 0
    let cp = 0
    if (c >= 0xC0 && c <= 0xDF) { n = 1; cp = c & 0x1F }
    else if (c >= 0xE0 && c <= 0xEF) { n = 2; cp = c & 0x0F }
    else if (c >= 0xF0 && c <= 0xF7) { n = 3; cp = c & 0x07 }
    else { out += REPLACEMENT; i++; continue }
    if (i + n >= bytes.length) { out += REPLACEMENT; break }
    for (let k = 1; k <= n; k++) cp = (cp << 6) | (bytes[i + k] & 0x3F)
    out += String.fromCodePoint(cp)
    i += n + 1
  }
  return out
}

const gbkIndex = (hi: number, lo: number) =>
  (hi - 0x81) * 190 + (lo < 0x7F ? lo - 0x40 : lo - 0x41)

/** GBK / GB2312 解码（用内置映射表，覆盖 0x81-0xFE 双字节区） */
export const decodeGbk = (bytes: Uint8Array): string => {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const hi = bytes[i]
    if (hi < 0x80) { out += String.fromCharCode(hi); i++; continue }
    if (hi == 0x80 || hi == 0xFF) { out += REPLACEMENT; i++; continue }
    const lo = bytes[i + 1]
    if (lo == null) { out += REPLACEMENT; break }
    i += 2
    if (lo >= 0x40 && lo <= 0xFE && lo != 0x7F) {
      out += GBK_TABLE[gbkIndex(hi, lo)] ?? REPLACEMENT
    } else {
      out += REPLACEMENT
    }
  }
  return out
}

/**
 * 修复「GBK 字节被按 ISO-8859-1 解码」产生的乱码（ÊýÒuÑÝÔå 这种）。
 * 判定很保守，只有在整段没有正常中文、却存在连续高位字符时才动手，
 * 因此正常的 UTF-8 中文 / 英文内容完全不受影响。
 */
export const repairMojibake = (s: string): string => {
  if (!s) return s
  if (/[\u4e00-\u9fff]/.test(s)) return s        // 已有正常中文，说明解码没问题
  if (!/[\u0080-\u00ff]{2,}/.test(s)) return s   // 没有连续高位字符，不像乱码
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c > 0xFF) return s                       // 混有超范围字符，不敢动
    bytes[i] = c
  }
  const fixed = decodeGbk(bytes)
  // 解出来得真有中文才算修复成功，否则保持原样
  return /[\u4e00-\u9fff]/.test(fixed) ? fixed : s
}

/**
 * 自动判断编码并解码：
 *   - 有 UTF-8 BOM → UTF-8
 *   - 整体是合法 UTF-8（纯 ASCII 也算）→ UTF-8
 *   - 否则按 GBK 解（中文环境 NAS 的常见情况）
 */
export const decodeText = (bytes: Uint8Array): string => {
  if (bytes.length === 0) return ''
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return decodeUtf8(bytes.subarray(3))
  if (isValidUtf8(bytes)) return decodeUtf8(bytes)
  return decodeGbk(bytes)
}
