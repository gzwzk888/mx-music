/**
 * 专辑文件夹封面：当音频文件内嵌封面读不到时，取同目录下的图片当封面。
 *
 * 适用场景：整张专辑是 WAV（WAV 没有标准封面字段，Android 也读不出 ID3 chunk），
 * 但文件夹里放着 cover.jpg / 封面.jpg 这类图片。
 *
 * 匹配规则：
 * 1. 文件名（不含扩展名）精确命中 cover / 封面 / 1，或含 封面，或命中 folder / front / album 等 → 用它
 * 2. 否则若目录里只有一张图片 → 也当作专辑封面
 * 3. 多张图片且都不匹配 → 不猜，返回 null（避免每首都用同一张不知名的图）
 */
import { readDir, type ReadDirItem } from 'react-native-fs'

/** 第一档：精确命中，按此顺序（用户指定：cover 最高 → 中文「封面」→ folder → 数字「1」= 扫描件正面） */
const TOP_EXACT = ['cover', '封面', 'folder', '1']
/** 第三档：名字里含「封面」（%封面% 模糊） */
const CN_FUZZY = '封面'
/** 第四档：其余关键词，仍按顺序尝试 精确 → 开头 → 包含 */
const REST_HITS = [
  'folder', 'front', 'album', 'albumcover', 'albumart', 'albumartsmall',
  'folderart', '封面图', '专辑图',
]
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp']

// 目录 → 封面路径（含 null 结果），避免每首歌都去读一次目录
const dirCache = new Map<string, string | null>()

const extOf = (name: string) => {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}
const baseOf = (name: string) => {
  const i = name.lastIndexOf('.')
  return i < 0 ? name : name.slice(0, i)
}
const dirOf = (p: string) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i <= 0 ? p : p.slice(0, i)
}

/** 明显不是封面的图（封底、盘面、内页…），多图时排除 */
const NAME_DENY = [
  'back', 'rear', 'disc', 'cd', 'dvd', 'tray', 'inlay', 'inside', 'booklet',
  'spine', 'matrix', 'label', 'lyric', 'scan', 'side',
  '封底', '底面', '盘面', '内页', '歌词', '扫描', '背面',
]

const pick = (items: ReadDirItem[]): string | null => {
  const imgs = items.filter(it => it.isFile() && IMAGE_EXTS.includes(extOf(it.name)))
  if (!imgs.length) return null
  const base = (n: string) => baseOf(n).trim().toLowerCase()

  // ── 第 1 档：cover / 封面 精确命中（cover 优先） ──
  for (const key of TOP_EXACT) {
    const hit = imgs.find(it => base(it.name) == key)
    if (hit) return hit.path
  }

  // ── 第 2 档：名字里含「封面」（01 封面、专辑封面、封面扫描…） ──
  const cnHit = imgs.find(it => base(it.name).includes(CN_FUZZY))
  if (cnHit) return cnHit.path

  // ── 第 3 档：其余关键词，依次试 精确 → 开头 → 包含 ──
  for (const key of REST_HITS) {
    const hit = imgs.find(it => base(it.name) == key)
    if (hit) return hit.path
  }
  for (const key of REST_HITS) {
    const hit = imgs.find(it => base(it.name).startsWith(key))
    if (hit) return hit.path
  }
  for (const key of REST_HITS) {
    const hit = imgs.find(it => base(it.name).includes(key))
    if (hit) return hit.path
  }

  // ── 第 4 档：排除封底/盘面这类，剩一张就用 ──
  //    注意：目录里有多张无法分辨的图（例如 1.jpg + 2.jpg 的扫描件）时，宁可不采信、
  //    返回 null 显示占位图，也不按编号/顺序猜——猜错等于给整张专辑挂错封面。
  const rest = imgs.filter(it => !NAME_DENY.some(d => base(it.name).includes(d)))
  if (rest.length == 1) return rest[0].path
  // ── 第 5 档：目录里总共只有一张图（哪怕叫 back.jpg） ──
  if (imgs.length == 1) return imgs[0].path

  // 多张且判断不出 → 不猜
  return null
}

/** 本机文件：查同目录封面 */
export const findFolderCover = async(filePath: string): Promise<string | null> => {
  if (!filePath || /^https?:\/\//i.test(filePath)) return null
  const dir = dirOf(filePath)
  if (dirCache.has(dir)) return dirCache.get(dir)!
  let result: string | null = null
  try {
    result = pick(await readDir(dir))
  } catch {
    result = null
  }
  dirCache.set(dir, result)
  return result
}

/** 远程（NAS）文件：按常见名逐个探测同目录图片（只留最常见的几个，避免每张专辑发几十次请求） */
const REMOTE_NAMES = [
  'cover.jpg', 'folder.jpg', '封面.jpg', 'front.jpg',
  'cover.png', 'folder.png',
]

/**
 * 一个名字的大小写变体：原样 → 首字母大写（Cover.jpg）→ 名大写 → 扩展名大写 → 全大写
 * （大小写敏感的服务端只认其中一种，例如只放了 COVER.JPG / Cover.jpeg）
 */
const caseVariants = (name: string): string[] => {
  const i = name.lastIndexOf('.')
  const stem = i < 0 ? name : name.slice(0, i)
  const ext = i < 0 ? '' : name.slice(i)
  const title = stem.charAt(0).toUpperCase() + stem.slice(1).toLowerCase() + ext.toLowerCase()
  const cands = [name, title, stem.toUpperCase() + ext, stem + ext.toUpperCase(), (stem + ext).toUpperCase()]
  const out: string[] = []
  for (const c of cands) if (!out.includes(c)) out.push(c)
  return out
}

const probe = async(dir: string, name: string): Promise<string | null> => {
  const url = `${dir}/${encodeURIComponent(name)}`
  // 必须带超时 + 校验 Content-Type：
  // QNAP 的 DLNA 对任意杂路径可能回 200（错误页/空体），只看 resp.ok 会拿到一个
  // 「永远打不开」的地址，图片组件就会一直卡在加载中，界面上表现为一块纯黑空白。
  const ctl = typeof AbortController != 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => { try { ctl.abort() } catch {} }, 3000) : null
  try {
    const resp = await fetch(url, { method: 'HEAD', signal: ctl ? ctl.signal : undefined })
    if (!resp.ok) return null
    const ct = (resp.headers.get('content-type') || '').toLowerCase()
    // 明确不是图片（如 text/html 错误页）就判失败；服务器没给类型时保守放行
    if (ct && !ct.startsWith('image/')) return null
    return url
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const findRemoteFolderCover = async(fileUrl: string): Promise<string | null> => {
  if (!/^https?:\/\//i.test(fileUrl)) return null
  const dir = fileUrl.replace(/\/[^/]*$/, '')
  if (!dir || dir == fileUrl) return null
  if (dirCache.has(dir)) return dirCache.get(dir)!
  let result: string | null = null
  // 第一轮：名单原样（最常见、零额外请求）
  for (const name of REMOTE_NAMES) {
    result = await probe(dir, name)
    if (result) break
  }
  // 第二轮：原样全都没命中，才试大小写变体（只对前两个最常见名字，控制请求量）
  if (!result) {
    for (const name of REMOTE_NAMES.slice(0, 2)) {
      for (const variant of caseVariants(name)) {
        if (variant === name) continue
        result = await probe(dir, variant)
        if (result) break
      }
      if (result) break
    }
  }
  dirCache.set(dir, result)
  return result
}

/** 清空缓存（重新扫描或手动刷新封面时调用） */
export const clearFolderCoverCache = () => {
  dirCache.clear()
}
