/**
 * 极简 DLNA / UPnP 浏览模块
 * 只做三件事：读取设备描述、浏览内容目录、把条目转换成可播放的地址
 * 说明：React Native 没有 XML 解析器，这里用正则拆 DIDL-Lite，够用且零依赖
 */

export interface NasDevice {
  name: string
  controlUrl: string
  baseUrl: string
}

export interface NasItem {
  id: string
  title: string
  isContainer: boolean
  artist: string
  album: string
  /** 已格式化为 mm:ss */
  interval: string | null
  url: string
  protocolInfo: string
  childCount: number
  ext: string
  /** DLNA 提供的专辑图地址（部分服务器会给出） */
  artUrl: string
  /** 音轨号（CUE 拆轨的专辑会给出） */
  trackNumber: number
  /** 精确时长（秒） */
  durationSec: number
  /** 文件字节数（用于识别 CUE 拆轨：多条指向同一个文件） */
  fileSize: number
  /** CUE 拆轨：本轨在整轨文件中的起始秒 */
  cueStart?: number
  /** CUE 拆轨：本轨结束秒 */
  cueEnd?: number
}

const parseDurationSec = (dur: string): number => {
  const m = /(\d+):(\d+):(\d+)(?:\.(\d+))?/.exec(dur || '')
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4] ?? 0) / 1000
  const m2 = /(\d+):(\d+)(?:\.(\d+))?/.exec(dur || '')
  if (m2) return Number(m2[1]) * 60 + Number(m2[2]) + Number(m2[3] ?? 0) / 1000
  return 0
}

/** CUE 分轨：同一音频被拆成多条（DLNA 里 size 相同、各自有音轨号），按音轨号排序并算出每轨区间 */
export const applyCueRanges = <T extends NasItem>(items: T[]): T[] => {
  const files = items.filter(i => !i.isContainer && i.url && i.trackNumber > 0)
  if (files.length < 2) return items

  const bySize = new Map<number, T[]>()
  for (const f of files) {
    if (!f.fileSize) continue
    const arr = bySize.get(f.fileSize) ?? []
    arr.push(f)
    bySize.set(f.fileSize, arr)
  }

  let group: T[] | null = null
  for (const arr of bySize.values()) {
    if (arr.length >= 2 && arr.every(i => i.durationSec > 0)) { group = arr; break }
  }
  if (!group) return items

  group.sort((a, b) => a.trackNumber - b.trackNumber)
  // DLNA 的每轨时长不含曲间间隙，直接累加会让后一轨起点偏早（听到上一轨尾巴）。
  // 这里给第 2 轨之后统一补 1.5 秒；若能读到 .cue 的 INDEX 时间码，会被精确值覆盖。
  const GAP_COMPENSATION = 1.5
  let acc = 0
  group.forEach((t, i) => {
    const start = acc + (i > 0 ? GAP_COMPENSATION : 0)
    t.cueStart = start
    acc += t.durationSec
    t.cueEnd = acc + GAP_COMPENSATION
  })
  return items
}

const unescapeXml = (str: string) => str
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')

const getTag = (xml: string, tag: string): string => {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = re.exec(xml)
  return m ? m[1].trim() : ''
}

const getAttr = (xml: string, attr: string): string => {
  const re = new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, 'i')
  const m = re.exec(xml)
  return m ? m[1] : ''
}

const fetchText = async(url: string, init?: RequestInit): Promise<string> => {
  const resp = await fetch(url, init)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return await resp.text()
}

/** 取条目里的专辑图地址（相对路径补全成绝对） */
const extractArt = (block: string, device: NasDevice): string => {
  const raw = unescapeXml(getTag(block, 'upnp:albumArtURI'))
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  return raw.startsWith('/') ? device.baseUrl + raw : ''
}

/** 把 00:03:59.000 转成 03:59 */
const formatInterval = (raw: string): string | null => {
  if (!raw) return null
  const parts = raw.split(':')
  if (parts.length < 2) return null
  const h = Number(parts[0])
  const m = Number(parts[1])
  const s = Math.floor(Number(parts[2] ?? 0))
  if (!Number.isFinite(m) || !Number.isFinite(s)) return null
  const mm = h > 0 ? h * 60 + m : m
  return `${String(mm).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 从 "192.168.x.x:8200" 或完整 URL 得到 baseUrl */
export const normalizeBaseUrl = (input: string): string => {
  let host = input.trim()
  if (!host) throw new Error('请输入 NAS 地址')
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`
  return host.replace(/\/+$/, '')
}

/** 读取设备描述，拿到 ContentDirectory 的控制地址 */
export const connectDevice = async(input: string): Promise<NasDevice> => {
  const baseUrl = normalizeBaseUrl(input)
  const xml = await fetchText(`${baseUrl}/rootDesc.xml`)
  const name = getTag(xml, 'friendlyName') || baseUrl
  const services = xml.match(/<service\b[\s\S]*?<\/service>/gi) ?? []
  for (const svc of services) {
    if (!getTag(svc, 'serviceType').includes('ContentDirectory')) continue
    let controlUrl = getTag(svc, 'controlURL')
    if (!controlUrl) continue
    if (controlUrl.startsWith('/')) controlUrl = baseUrl + controlUrl
    return { name, controlUrl, baseUrl }
  }
  throw new Error('该地址不是可用的 DLNA 媒体服务器（未找到 ContentDirectory）')
}

const buildBrowseBody = (objectId: string, start: number, count: number) => `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>${objectId}</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>${start}</StartingIndex>
      <RequestedCount>${count}</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`

/** 浏览某个目录，默认从根(0)开始 */
export const browse = async(device: NasDevice, objectId = '0', start = 0, count = 200): Promise<{ items: NasItem[], total: number }> => {
  const xml = await fetchText(device.controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
    },
    body: buildBrowseBody(objectId, start, count),
  })

  const totalRaw = getTag(xml, 'TotalMatches')
  const total = /^\d+$/.test(totalRaw) ? Number(totalRaw) : -1
  const didl = unescapeXml(getTag(xml, 'Result'))
  if (!didl) return { items: [], total }

  const blocks = didl.match(/<(item|container)\b[\s\S]*?<\/\1>/gi) ?? []
  const items: NasItem[] = []
  for (const block of blocks) {
    const isContainer = /^<container\b/i.test(block)
    const id = getAttr(block, 'id')
    if (!id) continue
    const resMatch = /<res\b([^>]*)>([\s\S]*?)<\/res>/i.exec(block)
    const resAttrs = resMatch ? resMatch[1] : ''
    const resUrl = resMatch ? unescapeXml(resMatch[2].trim()) : ''
    const ext = (/\.([a-z0-9]{2,5})(?:$|\?)/i.exec(resUrl) ?? [])[1]?.toLowerCase() ?? ''
    items.push({
      id,
      title: unescapeXml(getTag(block, 'dc:title')) || '(未命名)',
      isContainer,
      artist: unescapeXml(getTag(block, 'upnp:artist')),
      album: unescapeXml(getTag(block, 'upnp:album')),
      interval: formatInterval(getAttr(resAttrs, 'duration')),
      trackNumber: Number(unescapeXml(getTag(block, 'upnp:originalTrackNumber')) || 0) || 0,
      durationSec: parseDurationSec(getAttr(resAttrs, 'duration')),
      fileSize: Number(getAttr(resAttrs, 'size') || 0) || 0,
      url: resUrl,
      protocolInfo: getAttr(resAttrs, 'protocolInfo'),
      childCount: Number(getAttr(block, 'childCount') || 0),
      ext,
      artUrl: extractArt(block, device),
    })
  }
  return { items, total }
}

/** 把 DLNA 条目转成 LX 的本地歌曲结构（filePath 存 http 地址） */
export const toMusicInfo = (item: NasItem): LX.Music.MusicInfoLocal => ({
  id: `nas_${item.id}`,
  name: item.title.trim() || '(未命名)',
  singer: item.artist.trim(),
  source: 'local',
  interval: item.interval,
  meta: {
    songId: item.url,
    albumName: item.album.trim(),
    picUrl: item.artUrl || null,
    filePath: item.url,
    ext: item.ext,
    ...(item.cueStart != null ? { cueStart: item.cueStart, cueEnd: item.cueEnd } : {}),
  },
})
