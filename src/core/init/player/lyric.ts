import { init as initLyricPlayer, toggleTranslation, toggleRoma, play, pause, stop, setLyric, setPlaybackRate, handlePlay as handleLyricPlay } from '@/core/lyric'
import { updateSetting } from '@/core/common'
import { onDesktopLyricPositionChange, showDesktopLyric, onLyricLinePlay, showRemoteLyric } from '@/core/desktopLyric'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { getPosition } from '@/plugins/player'
import { updateNowPlayingTitles } from '@/plugins/player/utils'
import { setLastLyric } from '@/core/player/playInfo'

const updateRemoteLyric = async(lrc?: string) => {
  setLastLyric(lrc)
  if (lrc == null) {
    void updateNowPlayingTitles({
      title: playerState.musicInfo.name,
      artist: playerState.musicInfo.singer ?? '',
      album: playerState.musicInfo.album ?? '',
    })
  } else {
    void updateNowPlayingTitles({
      title: lrc,
      artist: `${playerState.musicInfo.name}${playerState.musicInfo.singer ? ` - ${playerState.musicInfo.singer}` : ''}`,
      album: playerState.musicInfo.album ?? '',
    })
  }
}

export default async(setting: LX.AppSetting) => {
  await initLyricPlayer()
  await Promise.all([
    setPlaybackRate(setting['player.playbackRate']),
    toggleTranslation(setting['player.isShowLyricTranslation']),
    toggleRoma(setting['player.isShowLyricRoma']),
  ])

  if (setting['desktopLyric.enable']) {
    showDesktopLyric().catch(() => {
      updateSetting({ 'desktopLyric.enable': false })
    })
  }
  if (setting['player.isShowBluetoothLyric']) {
    showRemoteLyric(true).catch(() => {
      updateSetting({ 'player.isShowBluetoothLyric': false })
    })
  }
  onDesktopLyricPositionChange(position => {
    updateSetting({
      'desktopLyric.position.x': position.x,
      'desktopLyric.position.y': position.y,
    })
  })
  onLyricLinePlay(({ text, extendedLyrics }) => {
    if (!text && !playerState.isPlay) {
      void updateRemoteLyric()
    } else {
      void updateRemoteLyric(text)
    }
  })


  // 歌词时钟校正：每秒核对一次播放器真实位置，偏差超过 300ms 才重新对齐
  // （对齐本身是重置歌词解析器基准，频繁重置会让同一行反复刷新，所以加阈值）
  let syncTime = 0
  let syncAt = 0
  const clearSyncClock = () => {
    syncAt = 0
  }
  global.app_event.on('lyricProgress', (time: number) => {
    const now = Date.now()
    if (syncAt) {
      const rate = settingState.setting['player.playbackRate'] || 1
      const expected = syncTime + (now - syncAt) * rate
      if (Math.abs(expected - time) < 300) return
    }
    syncAt = now
    syncTime = time
    handleLyricPlay(time)
    // 暂停时拖动进度：只把歌词定位到那一行，不让歌词时钟自己往前走
    if (!playerState.isPlay) pause()
  })
  global.app_event.on('pause', clearSyncClock)
  global.app_event.on('stop', clearSyncClock)
  global.app_event.on('musicToggled', clearSyncClock)

  // 人工微调（±秒）改变：播放位置没变，但歌词时间轴要重算，
  // 必须跳过 300ms 阈值直接按真实位置重对齐，否则调了没反应
  global.app_event.on('lyricOffsetChanged', () => {
    syncAt = 0
    void getPosition().then(position => {
      if (typeof position !== 'number' || position < 0) return
      handleLyricPlay(position * 1000)
      if (!playerState.isPlay) pause()
    }).catch(() => {})
  })

  global.app_event.on('play', play)
  global.app_event.on('pause', pause)
  global.app_event.on('stop', stop)
  global.app_event.on('error', pause)
  global.app_event.on('musicToggled', stop)
  global.app_event.on('lyricUpdated', setLyric)
}
