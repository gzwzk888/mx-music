import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { setCurrentTime, getDuration, getPosition } from '@/plugins/player'
import { formatPlayTime2 } from '@/utils/common'
import { savePlayInfo } from '@/utils/data'
import { throttleBackgroundTimer } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { onScreenStateChange } from '@/utils/nativeModules/utils'
import { AppState } from 'react-native'
import { ensureDesktopLyric } from '@/core/desktopLyric'
import { playNext } from '@/core/player/player'
import { getCueRange } from '@/core/nas/cueRanges'

const delaySavePlayInfo = throttleBackgroundTimer(() => {
  void savePlayInfo({
    time: playerState.progress.nowPlayTime,
    maxTime: playerState.progress.maxPlayTime,
    listId: playerState.playMusicInfo.listId!,
    index: playerState.playInfo.playIndex,
  })
}, 2000)

export default () => {
  // const updateMusicInfo = useCommit('list', 'updateMusicInfo')

  let updateTimeout: number | null = null

  let isScreenOn = true

  // 当前曲目的 CUE 区间（绝对秒）。非 CUE 曲目返回 0,0
  // 注意：playerState.musicInfo 是界面用的精简结构，没有 meta，
  // 原始 MusicInfo（带 meta.cueStart）在 playMusicInfo.musicInfo 里。
  const cueRange = () => {
    const raw: any = (playerState.playMusicInfo as any)?.musicInfo ?? playerState.musicInfo
    const meta: any = raw?.meta
    let start = typeof meta?.cueStart == 'number' ? meta.cueStart : 0
    let end = typeof meta?.cueEnd == 'number' ? meta.cueEnd : 0
    if (!start && !end) {
      // meta 被裁掉时的兜底：按歌曲 id 查登记表
      const reg = getCueRange(playerState.musicInfo.id)
      if (reg) { start = reg.start; end = reg.end }
    }
    return { start, end }
  }

  // CUE 拆轨：进到这轨就先 seek 到起点，播到终点就跳下一首
  let cueSeekKey = ''
  let cueSkipId = ''
  // 轨尾定时器：进度每秒才回调一次，靠它切轨会切晚（听到下一首的第一个音），
  // 所以按「剩余时长 - 余量」精确定时切
  let cueEndTimer: ReturnType<typeof setTimeout> | null = null
  const clearCueEndTimer = () => {
    if (cueEndTimer) {
      clearTimeout(cueEndTimer)
      cueEndTimer = null
    }
  }
  const scheduleCueEnd = (position: number) => {
    clearCueEndTimer()
    const { start, end } = cueRange()
    if (!(end > start)) return
    const id = playerState.musicInfo.id ?? ''
    const rate = settingState.setting['player.playbackRate'] || 1
    const remainMs = (end - position) * 1000 / rate
    if (remainMs <= 0) return
    cueEndTimer = setTimeout(() => {
      cueEndTimer = null
      if (playerState.musicInfo.id != id) return
      if (cueSkipId == id) return
      cueSkipId = id
      void playNext(false)
    }, Math.max(60, remainMs - 120))
  }
  const cueSeekTries: Record<string, number> = {}
  const cueSeekAt: Record<string, number> = {}
  const handleCueRange = (position: number) => {
    const raw: any = (playerState.playMusicInfo as any)?.musicInfo ?? playerState.musicInfo
    const meta: any = raw?.meta
    const id = playerState.musicInfo.id ?? ''
    if (!meta) return
    const start = typeof meta.cueStart == 'number' ? meta.cueStart : 0
    const end = typeof meta.cueEnd == 'number' ? meta.cueEnd : 0
    if (!start && !end) return
    if (cueSkipId && cueSkipId != id) cueSkipId = ''

    if (start > 0.5 && position < start - 2.5) {
      const key = `${id}:${start}`
      const tries = (cueSeekTries[key] ?? 0)
      // 首次 seek 有时会被播放器忽略（HTTP 大文件还没就绪），最多重试 5 次、每次间隔约 1 秒
      if (tries < 4 && Date.now() - (cueSeekAt[key] ?? 0) > 900) {
        cueSeekTries[key] = tries + 1
        cueSeekAt[key] = Date.now()
        cueSeekKey = key
        void setCurrentTime(start)
      }
      return
    }
    if (end > 0) scheduleCueEnd(position)
  }

  const getCurrentTime = () => {
    let id = playerState.musicInfo.id
    void getPosition().then(position => {
      if (!position || id != playerState.musicInfo.id) return
      const { start: cueStartNow, end: cueEndNow } = cueRange()
      if (cueEndNow > cueStartNow) {
        // CUE 拆轨：进度条显示的是「本轨内的相对时间」
        setNowPlayTime(Math.max(0, position - cueStartNow))
      } else {
        setNowPlayTime(position)
      }
      handleCueRange(position)
      if (!playerState.isPlay) return

      if (settingState.setting['player.isSavePlayTime'] && !playerState.playMusicInfo.isTempPlay && isScreenOn) {
        delaySavePlayInfo()
      }
    })
  }
  const getMaxTime = async() => {
    const duration = await getDuration()
    const { start: cueStartMax, end: cueEndMax } = cueRange()
    setMaxplayTime(cueEndMax > cueStartMax ? cueEndMax - cueStartMax : duration)

    if (playerState.playMusicInfo.musicInfo && 'source' in playerState.playMusicInfo.musicInfo && !playerState.playMusicInfo.musicInfo.interval) {
      // console.log(formatPlayTime2(playProgress.maxPlayTime))

      if (playerState.playMusicInfo.listId) {
        void updateListMusics([{
          id: playerState.playMusicInfo.listId,
          musicInfo: {
            ...playerState.playMusicInfo.musicInfo,
            interval: formatPlayTime2(playerState.progress.maxPlayTime),
          },
        }])
      }
    }
  }

  const clearUpdateTimeout = () => {
    if (!updateTimeout) return
    BackgroundTimer.clearInterval(updateTimeout)
    updateTimeout = null
  }
  const startUpdateTimeout = () => {
    if (!isScreenOn) return
    clearUpdateTimeout()
    updateTimeout = BackgroundTimer.setInterval(() => {
      getCurrentTime()
    }, 1000 / settingState.setting['player.playbackRate'])
    getCurrentTime()
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!playerState.musicInfo.id) return
    // console.log('setProgress', time, maxTime)
    const { start: cueStartSeek, end: cueEndSeek } = cueRange()
    const isCue = cueEndSeek > cueStartSeek
    setNowPlayTime(time)
    void setCurrentTime(isCue ? cueStartSeek + time : time)

    if (maxTime != null) setMaxplayTime(maxTime)

    // if (!isPlay) audio.play()
  }


  const handlePlay = () => {
    cueSkipId = ''
    void getMaxTime()
    // prevProgressStatus = 'normal'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    startUpdateTimeout()
  }
  const handlePause = () => {
    clearCueEndTimer()
    // prevProgressStatus = 'paused'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    // clearBufferTimeout()
    clearUpdateTimeout()
  }

  const handleStop = () => {
    clearCueEndTimer()
    clearUpdateTimeout()
    setNowPlayTime(0)
    setMaxplayTime(0)
    // prevProgressStatus = 'none'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
  }

  const handleError = () => {
    // if (!restorePlayTime) restorePlayTime = getCurrentTime() // 记录出错的播放时间
    // console.log('handleError')
    // prevProgressStatus = 'error'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    clearUpdateTimeout()
  }


  const handleSetPlayInfo = () => {
    // restorePlayTime = playProgress.nowPlayTime
    // void setCurrentTime(playerState.progress.nowPlayTime)
    // setMaxplayTime(playProgress.maxPlayTime)
    handlePause()
    if (!playerState.playMusicInfo.isTempPlay) {
      void savePlayInfo({
        time: playerState.progress.nowPlayTime,
        maxTime: playerState.progress.maxPlayTime,
        listId: playerState.playMusicInfo.listId!,
        index: playerState.playInfo.playIndex,
      })
    }
  }

  // watch(() => playerState.progress.nowPlayTime, (newValue, oldValue) => {
  //   if (settingState.setting['player.isSavePlayTime'] && !playMusicInfo.isTempPlay) {
  //     delaySavePlayInfo({
  //       time: newValue,
  //       maxTime: playerState.progress.maxPlayTime,
  //       listId: playMusicInfo.listId as string,
  //       index: playInfo.playIndex,
  //     })
  //   }
  // })
  // watch(() => playerState.progress.maxPlayTime, maxPlayTime => {
  //   if (!playMusicInfo.isTempPlay) {
  //     delaySavePlayInfo({
  //       time: playerState.progress.nowPlayTime,
  //       maxTime: maxPlayTime,
  //       listId: playMusicInfo.listId as string,
  //       index: playInfo.playIndex,
  //     })
  //   }
  // })

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys, settings) => {
    if (keys.includes('player.playbackRate')) startUpdateTimeout()
  }

  const handleScreenStateChanged: Parameters<typeof onScreenStateChange>[0] = (state) => {
    isScreenOn = state == 'ON'
    if (isScreenOn) {
      if (playerState.isPlay) startUpdateTimeout()
    } else clearUpdateTimeout()
  }

  // 修复在某些设备上屏幕状态改变事件未触发导致的进度条未更新的问题
  AppState.addEventListener('change', (state) => {
    if (state == 'active' && !isScreenOn) handleScreenStateChanged('ON')
    if (state == 'active') void ensureDesktopLyric()
  })

  global.app_event.on('play', handlePlay)
  global.app_event.on('pause', handlePause)
  global.app_event.on('stop', handleStop)
  global.app_event.on('error', handleError)
  global.app_event.on('setProgress', setProgress)
  // global.app_event.on(eventPlayerNames.restorePlay, handleRestorePlay)
  // global.app_event.on('playerLoadeddata', handleLoadeddata)
  // global.app_event.on('playerCanplay', handleCanplay)
  // global.app_event.on('playerWaiting', handleWating)
  // global.app_event.on('playerEmptied', handleEmpied)
  global.app_event.on('musicToggled', handleSetPlayInfo)
  global.state_event.on('configUpdated', handleConfigUpdated)

  onScreenStateChange(handleScreenStateChanged)
}
