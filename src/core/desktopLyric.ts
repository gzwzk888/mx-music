import {
  hideDesktopLyricView,
  showDesktopLyricView,
  setSendLyricTextEvent,
  setLyric,
  play,
  pause,
  setPlaybackRate,
  toggleTranslation,
  toggleRoma,
  toggleLock,
  setColor,
  setAlpha,
  setTextSize,
  setBold,
  setShowToggleAnima,
  setSingleLine,
  setPosition,
  setMaxLineNum,
  setWidth,
  setLyricTextPosition,
  checkOverlayPermission,
  openOverlayPermissionActivity,
  onPositionChange,
} from '@/utils/nativeModules/lyricDesktop'
import settingState from '@/store/setting/state'
import playerState from '@/store/player/state'
import { tranditionalize } from '@/utils/simplify-chinese-main'
import { getPosition } from '@/plugins/player'
export {
  onLyricLinePlay,
} from '@/utils/nativeModules/lyricDesktop'

let overlayShown = false

export const isDesktopLyricShown = () => overlayShown

/** 播放/回到前台时自愈：开关是开的但窗口没了，就重新挂上（例如被系统回收、或从未成功创建） */
export const ensureDesktopLyric = async() => {
  if (!settingState.setting['desktopLyric.enable']) return
  if (overlayShown) return
  try {
    await checkOverlayPermission()
    await showDesktopLyric()
  } catch {}
}

export const showDesktopLyric = async() => {
  const setting = settingState.setting
  await showDesktopLyricView({
    isShowToggleAnima: setting['desktopLyric.showToggleAnima'],
    isSingleLine: setting['desktopLyric.isSingleLine'],
    isLock: setting['desktopLyric.isLock'],
    unplayColor: setting['desktopLyric.style.lyricUnplayColor'],
    playedColor: setting['desktopLyric.style.lyricPlayedColor'],
    shadowColor: setting['desktopLyric.style.lyricShadowColor'],
    opacity: setting['desktopLyric.style.opacity'],
    textSize: setting['desktopLyric.style.fontSize'],
    width: setting['desktopLyric.width'],
    maxLineNum: setting['desktopLyric.maxLineNum'],
    positionX: setting['desktopLyric.position.x'],
    positionY: setting['desktopLyric.position.y'],
    textPositionX: setting['desktopLyric.textPosition.x'],
    textPositionY: setting['desktopLyric.textPosition.y'],
  })
  let lrc = playerState.musicInfo.lrc ?? ''
  let tlrc = playerState.musicInfo.tlrc ?? ''
  let rlrc = playerState.musicInfo.rlrc ?? ''
  if (setting['player.isS2t']) {
    lrc = tranditionalize(lrc)
    tlrc = tranditionalize(tlrc)
  }
  await setLyric(lrc, tlrc, rlrc)
  try {
    await setBold(setting['desktopLyric.style.isBold'])
  } catch {}
  overlayShown = true
  if (playerState.isPlay && !global.lx.gettingUrlId) {
    void getPosition().then(position => {
      void play(position * 1000)
    })
  }
}

export const hideDesktopLyric = async() => {
  overlayShown = false
  return hideDesktopLyricView()
}

export const playDesktopLyric = play
export const pauseDesktopLyric = pause
export const setDesktopLyric = setLyric
export const setDesktopLyricPlaybackRate = setPlaybackRate
export const toggleDesktopLyricTranslation = toggleTranslation
export const toggleDesktopLyricRoma = toggleRoma
export const toggleDesktopLyricLock = toggleLock
export const setDesktopLyricColor = async(unplayColor: string | null, playedColor: string | null, shadowColor: string | null) => {
  return setColor(unplayColor ?? settingState.setting['desktopLyric.style.lyricUnplayColor'],
    playedColor ?? settingState.setting['desktopLyric.style.lyricPlayedColor'],
    shadowColor ?? settingState.setting['desktopLyric.style.lyricShadowColor'],
  )
}
export const setDesktopLyricAlpha = setAlpha
export const setDesktopLyricBold = setBold
export const setDesktopLyricTextSize = setTextSize
export const setShowDesktopLyricToggleAnima = setShowToggleAnima
export const setDesktopLyricSingleLine = setSingleLine
export const setDesktopLyricPosition = setPosition
export const setDesktopLyricMaxLineNum = setMaxLineNum
export const setDesktopLyricWidth = setWidth
export const setDesktopLyricTextPosition = async(x: LX.AppSetting['desktopLyric.textPosition.x'] | null, y: LX.AppSetting['desktopLyric.textPosition.y'] | null) => {
  return setLyricTextPosition(x ?? settingState.setting['desktopLyric.textPosition.x'], y ?? settingState.setting['desktopLyric.textPosition.y'])
}
export const checkDesktopLyricOverlayPermission = checkOverlayPermission
export const openDesktopLyricOverlayPermissionActivity = openOverlayPermissionActivity
export const onDesktopLyricPositionChange = onPositionChange


export const showRemoteLyric = async(isSend: boolean) => {
  await setSendLyricTextEvent(isSend)
  if (isSend) {
    let lrc = playerState.musicInfo.lrc ?? ''
    let tlrc = playerState.musicInfo.tlrc ?? ''
    let rlrc = playerState.musicInfo.rlrc ?? ''
    if (settingState.setting['player.isS2t']) {
      lrc = tranditionalize(lrc)
      tlrc = tranditionalize(tlrc)
    }
    await setLyric(lrc, tlrc, rlrc)
    if (playerState.isPlay && !global.lx.gettingUrlId) {
      void getPosition().then(position => {
        void play(position * 1000)
      })
    }
  }
}
