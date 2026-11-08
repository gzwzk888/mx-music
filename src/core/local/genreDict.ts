/**
 * 风格字典与筛选规则（本机 + NAS 共用）
 *
 * 字典来源：每次扫描（本机曲库 / NAS 建索引）都把遇到的风格并进来，去重后持久化。
 * 筛选规则：必须「有封面」，风格命中当前选中的集合（未选=不限风格）。
 *
 * 垃圾值（Unknown / Other / 版权串 / 超长字符串）统一归到「未分类」，
 * 否则字典里会混进 `©CNHiFi.COM`、`环球唱片/宝丽金唱片 523 641-2 南山兄原抓` 这种东西。
 */
import { getData, saveData } from '@/plugins/storage'

export const GENRE_OTHER = '未分类'
const DICT_KEY = '@mx_genre_dict_v1'
/** 风格筛选（JSON 数组字符串）：默认只留 Pop */
export const GENRE_FILTER_KEY = 'mx.genreFilter'

/**
 * 风格 chips 的固定显示顺序（用户指定）。
 * 「全部」由空字符串代表，排在最前；不在本表里的风格一律并入 GENRE_OTHERS。
 */
export const GENRE_ORDER = ['Pop', 'Classical', 'HIFI TEST', 'New Age', 'story'] as const
/** 兜底分组：所有不符合 GENRE_ORDER 的风格（含「未分类」）都归到这里 */
export const GENRE_OTHERS = 'others'

const ORDER_LOWER = GENRE_ORDER.map(s => s.toLowerCase())

/**
 * 把规范化后的风格名映射到 chips 上显示的标签。
 * 大小写不敏感（pop / POP → Pop）；不认识的返回 GENRE_OTHERS。
 */
export const chipOfGenre = (norm?: string | null): string => {
  const k = (norm ?? '').trim().toLowerCase()
  const i = ORDER_LOWER.indexOf(k)
  return i >= 0 ? GENRE_ORDER[i] : GENRE_OTHERS
}

const JUNK = /^(unknown|other|none|null|n\/a|未知|未分类)$/i

let dict: string[] = []
let loaded = false

/** 规范化一个风格值：垃圾值归「未分类」 */
export const normGenre = (raw?: string | null): string => {
  const s = (raw ?? '').trim()
  if (!s) return GENRE_OTHER
  if (JUNK.test(s)) return GENRE_OTHER
  if (s.length > 24) return GENRE_OTHER
  if (/\.(com|cn|net)\b|©|®/i.test(s)) return GENRE_OTHER
  return s
}

export const loadGenreDict = async(): Promise<string[]> => {
  if (loaded) return dict
  loaded = true
  try {
    const saved = await getData<string[]>(DICT_KEY)
    if (Array.isArray(saved)) dict = saved
  } catch {}
  return dict
}

/** 扫描后调用：把这一批曲目的风格并进字典（有变化才落盘） */
export const addGenres = async(genres: Array<string | undefined | null>): Promise<string[]> => {
  const base = await loadGenreDict()
  const set = new Set(base)
  const before = set.size
  for (const g of genres) set.add(normGenre(g))
  if (set.size == before) return dict
  dict = [...set].sort((a, b) => a.localeCompare(b))
  try { await saveData(DICT_KEY, dict) } catch {}
  try { global.state_event.mxGenreDictUpdated() } catch {}
  return dict
}

export const getGenreDict = (): string[] => dict

/** 解析筛选值（可能是 JSON 数组字符串、真数组、空） */
export const parseGenreFilter = (raw: any): string[] => {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw != 'string' || !raw.trim()) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export interface GenreFilterable {
  genre?: string | null
  hasCover?: boolean
}

/** 是否显示：有封面是硬条件；选中集合为空 = 不限风格 */
export const passGenreFilter = (item: GenreFilterable, selected: string[]): boolean => {
  if (!item.hasCover) return false
  if (!selected.length) return true
  return selected.includes(normGenre(item.genre))
}
