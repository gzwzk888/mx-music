/**
 * CUE 解析：拿到 INDEX 01 精确时间码，用于 CUE 整轨 WAV 的分轨播放
 */

export interface CueTrack {
  number: number
  title: string
  /** 起始秒 */
  start: number
}

const toSec = (mm: string, ss: string, ff: string) => {
  const m = Number(mm) || 0
  const s = Number(ss) || 0
  const f = Number(ff) || 0
  return m * 60 + s + f / 75
}

/** 解析 cue 文本，返回按音轨号排序的轨道（含起始秒） */
export const parseCue = (text: string): CueTrack[] => {
  const lines = text.split(/\r?\n/)
  const tracks: CueTrack[] = []
  let cur: CueTrack | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const mTrack = /^TRACK\s+(\d+)\s+AUDIO/i.exec(line)
    if (mTrack) {
      cur = { number: Number(mTrack[1]), title: '', start: -1 }
      tracks.push(cur)
      continue
    }
    if (!cur) continue
    const mTitle = /^TITLE\s+"?(.*?)"?$/i.exec(line)
    if (mTitle && !cur.title) {
      cur.title = mTitle[1].trim()
      continue
    }
    const mIndex = /^INDEX\s+01\s+(\d+):(\d+):(\d+)/i.exec(line)
    if (mIndex) {
      cur.start = toSec(mIndex[1], mIndex[2], mIndex[3])
    }
  }

  return tracks
    .filter(t => t.start >= 0)
    .sort((a, b) => a.number - b.number)
}

/** 把 cue 的起始时间套到条目上（按音轨号匹配）；最后一轨的结束时间取整轨时长 */
export const applyCueTracks = <T extends { trackNumber: number, cueStart?: number, cueEnd?: number }>(
  items: T[],
  tracks: CueTrack[],
  fileDuration: number,
): number => {
  if (!tracks.length) return 0
  let applied = 0
  for (const it of items) {
    const hit = tracks.find(t => t.number === it.trackNumber)
    if (!hit) continue
    const idx = tracks.indexOf(hit)
    const next = tracks[idx + 1]
    it.cueStart = hit.start
    it.cueEnd = next ? next.start : (fileDuration || hit.start)
    applied++
  }
  return applied
}
