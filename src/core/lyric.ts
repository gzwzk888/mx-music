import {
  play as lrcPlay,
  setLyric as lrcSetLyric,
  pause as lrcPause,
  setPlaybackRate as lrcSetPlaybackRate,
  toggleTranslation as lrcToggleTranslation,
  toggleRoma as lrcToggleRoma,
  init as lrcInit,
} from '@/plugins/lyric'
import {
  playDesktopLyric,
  setDesktopLyric,
  pauseDesktopLyric,
  setDesktopLyricPlaybackRate,
  toggleDesktopLyricTranslation,
  toggleDesktopLyricRoma,
} from '@/core/desktopLyric'
import { getPosition } from '@/plugins/player'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { updateNowPlayingTitles } from '@/plugins/player/utils'
import { getLyricOffset, loadLyricOffsets } from '@/core/lyricOffset'
import { getCueRange } from '@/core/nas/cueRanges'

/**
 * init lyric
 */
export const init = async() => {
  void loadLyricOffsets()
  return lrcInit()
}

/**
 * set lyric
 * @param lyric lyric str
 * @param translation lyric translation
 */
const handleSetLyric = async(lyric: string, translation = '', romalrc = '') => {
  lrcSetLyric(lyric, translation, romalrc)
  await setDesktopLyric(lyric, translation, romalrc)
  if (settingState.setting['player.isShowBluetoothFullLyric']) {
    void updateNowPlayingTitles({
      lyric,
    })
  }
}

/**
 * 判断这首歌的歌词时间轴是「单曲」还是「整轨」
 * CUE 拆轨时两种歌词都可能出现：按曲名搜到的是单曲时间轴（从 0 起），
 * 与整轨音频同名的 .lrc 是文件时间轴（从整个 flac 的 0 起）。
 * 用「歌词最后一行的位置」和「本轨时长」比较来分辨，误判时最多退回原来的行为。
 */
const cueLrcFullFile = new Map<string, boolean>()
const isFullFileLrc = (id: string, lrc: string, durMs: number) => {
  const key = `${id}:${lrc.length}`
  const hit = cueLrcFullFile.get(key)
  if (hit != null) return hit
  let maxMs = 0
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lrc))) {
    const frac = m[3] ?? ''
    const ms = Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(frac || 0) * (frac.length == 3 ? 1 : frac.length == 2 ? 10 : 100)
    if (ms > maxMs) maxMs = ms
  }
  const full = durMs > 0 && maxMs > durMs * 1.05
  if (cueLrcFullFile.size > 200) cueLrcFullFile.clear()
  cueLrcFullFile.set(key, full)
  return full
}

/**
 * play lyric
 * @param time 播放器原始位置（毫秒；CUE 整轨是「文件内绝对位置」）
 */
export const handlePlay = (time: number) => {
  const musicId = (playerState.playMusicInfo.musicInfo as any)?.id as string | undefined
  let relTime = time
  const range = musicId ? getCueRange(musicId) : undefined
  if (range && range.end > range.start && time >= range.start * 1000) {
    const durMs = (range.end - range.start) * 1000
    const lrc = (playerState.musicInfo as any)?.lrc as string | undefined
    // 整轨时间轴的歌词不能减起点，否则会把本来正确的对成错的
    if (!lrc || !isFullFileLrc(musicId!, lrc, durMs)) {
      relTime = Math.max(0, time - range.start * 1000)
    }
  }
  // 按歌曲套用人工微调（正数=歌词提前）
  const time2 = musicId ? Math.max(0, relTime + getLyricOffset(musicId)) : relTime
  lrcPlay(time2)
  void playDesktopLyric(time2)
}

/**
 * pause lyric
 */
export const pause = () => {
  lrcPause()
  void pauseDesktopLyric()
}

/**
 * stop lyric
 */
export const stop = () => {
  void handleSetLyric('')
}

/**
 * set playback rate
 * @param playbackRate playback rate
 */
export const setPlaybackRate = async(playbackRate: number) => {
  lrcSetPlaybackRate(playbackRate)
  await setDesktopLyricPlaybackRate(playbackRate)
  if (playerState.isPlay) {
    setTimeout(() => {
      void getPosition().then((position) => {
        handlePlay(position * 1000)
      })
    })
  }
}

/**
 * toggle show translation
 * @param isShowTranslation is show translation
 */
export const toggleTranslation = async(isShowTranslation: boolean) => {
  lrcToggleTranslation(isShowTranslation)
  await toggleDesktopLyricTranslation(isShowTranslation)
  if (playerState.isPlay) play()
}

/**
 * toggle show roma lyric
 * @param isShowLyricRoma is show roma lyric
 */
export const toggleRoma = async(isShowLyricRoma: boolean) => {
  lrcToggleRoma(isShowLyricRoma)
  await toggleDesktopLyricRoma(isShowLyricRoma)
  if (playerState.isPlay) play()
}

export const play = () => {
  void getPosition().then((position) => {
    handlePlay(position * 1000)
  })
}


export const setLyric = async() => {
  if (!playerState.musicInfo.id) return
  if (playerState.musicInfo.lrc) {
    let tlrc = ''
    let rlrc = ''
    if (playerState.musicInfo.tlrc) tlrc = playerState.musicInfo.tlrc
    if (playerState.musicInfo.rlrc) rlrc = playerState.musicInfo.rlrc
    await handleSetLyric(playerState.musicInfo.lrc, tlrc, rlrc)
  }

  if (playerState.isPlay) play()
}
