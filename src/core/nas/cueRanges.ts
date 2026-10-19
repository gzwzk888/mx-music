/**
 * CUE 区间登记表：万一 meta 在列表存取中被裁掉，播放时还能按歌曲 id 找回区间
 */
const map = new Map<string, { start: number, end: number }>()

export const setCueRange = (id: string, r?: { start?: number, end?: number }) => {
  if (!id) return
  if (typeof r?.start != 'number') {
    map.delete(id)
    return
  }
  map.set(id, { start: r.start, end: typeof r.end == 'number' ? r.end : 0 })
}

export const getCueRange = (id?: string | null) => id ? map.get(id) : undefined
