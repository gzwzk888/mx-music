/**
 * 播放页 · 手机 / 平板（Onkyo 语言）
 * 竖屏：虚化封面背景 + 封面/歌词滑动 + 底部信息与控件（歌词页占满整屏）
 * 横屏 / 平板：左栏「封面 + 播放控件」，右栏常驻歌词（与平板同一套代码）
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image as RNImage, Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import Slider from '@react-native-community/slider'
import PagerView from 'react-native-pager-view'
import Text from '@/components/common/Text'
import Image from '@/components/common/Image'
import { MX } from '@/theme/mx'
import { MxActionSheet } from '@/components/mx'
import {
  IconClock, IconMore, IconChevronDown, IconPlayWide, IconPauseWide, IconPrevWide, IconNextWide,
  IconRepeatWide, IconRepeatOneWide, IconOrderWide, IconShuffleWide, IconVolumeWide, IconEqLetter,
  IconHeart, IconPlus, IconLyrics, IconList, IconClose, IconReturnWide,
} from '@/components/mx/Icons'
import { usePlayerMusicInfo, usePlayMusicInfo, useProgress, useIsPlay } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { useWindowSize } from '@/utils/hooks'
import { useInLove } from '../components/useInLove'
import { togglePlay, playNext, playPrev } from '@/core/player/player'
import { setCurrentTime, setVolume } from '@/plugins/player'
import { updateSetting } from '@/core/common'
import { addListMusics, removeListMusics } from '@/core/list'
import { LIST_IDS, MUSIC_TOGGLE_MODE, MX_CAR_BUILD } from '@/config/constant'
import { pop } from '@/navigation'
import commonState from '@/store/common/state'
import { toast } from '@/utils/tools'
import { useI18n } from '@/lang'
import { readAudioSpec } from '@/utils/nativeModules/mediaScan'
import LyricView from './LyricView'
import SidePanel from './SidePanel'
import InfoModal from '../InfoModal'
import ArtistModal from '../ArtistModal'
import LyricSearchModal from '../LyricSearchModal'
import LyricOffsetModal from '../LyricOffsetModal'
import EqModal from './EqModal'
import SettingPopup, { type SettingPopupType } from '../components/SettingPopup'
import MusicAddModal, { type MusicAddModalType } from '@/components/MusicAddModal'
import { clearSleepTimer, getSleepTimer, setSleepTimer, subscribeSleepTimer } from '@/core/player/sleepTimer'

// 主控图标尺寸（这一版整体放大）
const ICON_MAIN = 36
const ICON_PLAY = 50
// 四个小键（循环 / 随机 / 音量 / EQ）统一 40dp —— 竖屏 / 平板 / 车机全部一致
const ICON_KEY = 40

const withAlpha = (hex: string, a: number) => {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

/* ------------------------------ 主控按钮 ------------------------------ */

const RepeatBtn = ({ size = ICON_KEY }: { size?: number }) => {
  const mode = useSettingValue('player.togglePlayMethod')
  const t = useI18n()
  const icon = useMemo(() => {
    if (mode == MUSIC_TOGGLE_MODE.singleLoop) return <IconRepeatOneWide size={size} color={MX.color.accent} />
    if (mode == MUSIC_TOGGLE_MODE.list) return <IconOrderWide size={size} color={MX.color.text2} />
    return <IconRepeatWide size={size} color={MX.color.accent} />
  }, [mode, size])
  const onPress = () => {
    let next: LX.AppSetting['player.togglePlayMethod'] = MUSIC_TOGGLE_MODE.listLoop
    if (mode == MUSIC_TOGGLE_MODE.listLoop) next = MUSIC_TOGGLE_MODE.singleLoop
    else if (mode == MUSIC_TOGGLE_MODE.singleLoop) next = MUSIC_TOGGLE_MODE.list
    updateSetting({ 'player.togglePlayMethod': next })
    toast(t(next == MUSIC_TOGGLE_MODE.listLoop ? 'play_list_loop' : next == MUSIC_TOGGLE_MODE.singleLoop ? 'play_single_loop' : 'play_list_order'))
  }
  return <TouchableOpacity onPress={onPress} hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }} activeOpacity={0.6}>{icon}</TouchableOpacity>
}

const ShuffleBtn = ({ size = ICON_KEY }: { size?: number }) => {
  const mode = useSettingValue('player.togglePlayMethod')
  const t = useI18n()
  const on = mode == MUSIC_TOGGLE_MODE.random
  return (
    <TouchableOpacity
      activeOpacity={0.6}
      hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
      onPress={() => {
        updateSetting({ 'player.togglePlayMethod': on ? MUSIC_TOGGLE_MODE.listLoop : MUSIC_TOGGLE_MODE.random })
        toast(t(on ? 'play_list_loop' : 'play_list_random'))
      }}
    >
      <IconShuffleWide size={size} color={on ? MX.color.accent : MX.color.text2} />
    </TouchableOpacity>
  )
}

/* ---------------------------------- 主体 ---------------------------------- */

export default memo(({ componentId }: { componentId: string }) => {
  const t = useI18n()
  const musicInfo = usePlayerMusicInfo()
  const playMusicInfo = usePlayMusicInfo()
  const progress = useProgress()
  const isPlay = useIsPlay()
  const statusBarHeight = useStatusbarHeight()
  const inLove = useInLove()
  const volume = useSettingValue('player.volume')
  const { width: winW, height: winH } = useWindowSize()
  const landscape = winW > winH
  // 屏幕最短边 ≥ 600dp：车机（720dp）/ 平板 → HD 三列；手机横屏（约 360dp）→ 普通两列
  // 最短边 ≥ 600dp（车机 720dp / 平板）→ HD 三列；手机横屏（约 360dp）→ 两列
  const isWideScreen = Math.min(winW, winH) >= 600
  // 矮屏（手机横屏约 360dp）放不下「音量条」这一整行，收进工具条的 EQ 按钮，把高度让给封面
  const hideVolumeRow = false   // 音量条一律常驻（矮屏靠压缩行高，不隐藏）

  const settingPopupRef = useRef<SettingPopupType>(null)
  const addModalRef = useRef<MusicAddModalType>(null)
  const pagerRef = useRef<PagerView>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [seeking, setSeeking] = useState<number | null>(null)
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null)
  const [sleepOpen, setSleepOpen] = useState(false)
  const [eqOpen, setEqOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [artistOpen, setArtistOpen] = useState(false)
  const [lyricSearchOpen, setLyricSearchOpen] = useState(false)
  const [offsetOpen, setOffsetOpen] = useState(false)
  const [flashBtn, setFlashBtn] = useState(0) // 1=上一首 2=下一首
  const flashTimer = useRef<any>(null)
  const [spec, setSpec] = useState<{ sampleRate: number, bits: number, bitrate: number } | null>(null)
  const [coverBox, setCoverBox] = useState({ w: 0, h: 0 })
  const [, forceTick] = useState(0)

  useEffect(() => subscribeSleepTimer(() => { forceTick(v => v + 1) }), [])

  const sleep = getSleepTimer()
  const info = musicInfo as any
  // 完整歌曲信息（含 meta.filePath / ext），playerMusicInfo 是精简版
  const full = (playMusicInfo?.musicInfo ?? {}) as any
  const meta = full?.meta ?? {}
  const pic = info?.pic as string | undefined
  const filePath = String(meta.filePath ?? '')
  const isNas = /^https?:/i.test(filePath)
  const ext = String(meta.ext ?? (/.[a-z0-9]{2,5}$/i.exec(filePath)?.[0].slice(1) ?? '')).toUpperCase()
  const fileName = filePath ? (() => { const n = filePath.split('/').pop() || ''; try { return decodeURIComponent(n) } catch { return n } })() : ''

  // 本机文件读采样率/位深/码率（NAS 是 http 流，读不到文件头）
  useEffect(() => {
    setSpec(null)
    if (isNas || !filePath) return
    let alive = true
    void readAudioSpec(filePath).then(res => { if (alive && res) setSpec(res) }).catch(() => {})
    return () => { alive = false }
  }, [filePath, isNas])

  const flash = (which: number) => {
    setFlashBtn(which)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => { setFlashBtn(0) }, 220)
  }

  const close = useCallback(() => {
    const id = commonState.componentIds.playDetail
    if (id) void pop(id)
  }, [])

  const handleSeek = (v: number) => {
    if (!progress.maxPlayTime) return
    setSeeking(v)
  }
  const handleSeekEnd = (v: number) => {
    const max = progress.maxPlayTime || 0
    setSeeking(null)
    if (max > 0) void setCurrentTime(max * v)
  }

  const toggleLove = useCallback(() => {
    const id = String(full?.id ?? info?.id ?? '')
    if (!id) return
    if (inLove) void removeListMusics(LIST_IDS.LOVE, [id])
    else void addListMusics(LIST_IDS.LOVE, [full as LX.Music.MusicInfo], 'bottom')
  }, [inLove, full, info?.id])

  const showAdd = () => {
    if (!info?.id) return
    // 必须用 playMusicInfo 里的完整对象：playerMusicInfo 只有 id/name/singer 等基础字段，
    // 缺 meta.filePath / ext，加进列表后既播不出也没有封面（原来就错在这里）
    addModalRef.current?.show({
      musicInfo: (full?.id ? full : musicInfo) as LX.Music.MusicInfo,
      isMove: false,
      listId: commonState.componentIds.playDetail ?? '',
    })
  }

  const remainText = () => {
    const max = progress.maxPlayTime || 0
    if (!max) return ''
    const now = seeking != null ? max * seeking : progress.nowPlayTime
    const left = Math.max(max - now, 0)
    const m = Math.floor(left / 60)
    const s = Math.floor(left % 60)
    return `-${m}:${String(s).padStart(2, '0')}`
  }

  // 格式行：FLAC · 44.1kHz · 16bit · 1411kbps · 本机/NAS
  const formatText = useMemo(() => {
    const parts: string[] = []
    if (ext) parts.push(ext)
    if (spec?.sampleRate) parts.push(`${(spec.sampleRate / 1000).toFixed(1).replace('.0', '')}kHz`)
    if (spec?.bits) parts.push(`${spec.bits}bit`)
    if (spec?.bitrate) parts.push(`${Math.round(spec.bitrate / 1000)}kbps`)
    parts.push(isNas ? 'NAS' : t('lib_badge_local'))
    return parts.join(' · ')
  }, [ext, spec, isNas])

  const volumeValue = volumeDraft ?? volume ?? 1

  /* ------------------------------ 片段 ------------------------------ */

  // 两列布局自带工具条（返回 / 时钟 / 菜单），顶部不再另画 header
  const hideHeader = landscape && !isWideScreen
  // 车机横屏：顶部整条让给车机系统信号栏
  const header = hideHeader ? null : (
    <View style={landscape
      ? { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 20, height: 34 + statusBarHeight, paddingTop: statusBarHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 }
      : { height: 44 + statusBarHeight, paddingTop: statusBarHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 }}>
      <TouchableOpacity
        onPress={close}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={landscape
          ? { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(70,170,255,0.18)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(70,170,255,0.55)' }
          : undefined}
      >
        {landscape
          ? <><IconReturnWide size={16} color={MX.color.accent} strokeWidth={2} /><Text size={13.5} color={MX.color.accent}>{t('back')}</Text></>
          : <IconChevronDown size={22} color={MX.color.text} />}
      </TouchableOpacity>
      {landscape ? null : <Text size={11.5} color={MX.color.text3} style={{ letterSpacing: 1.2 }}>{t('player_now_playing')}</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <TouchableOpacity onPress={() => { setSleepOpen(true) }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <IconClock size={20} color={sleep.minutes ? MX.color.accent : MX.color.text2} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setMenuOpen(true) }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <IconMore size={20} color={MX.color.text2} />
        </TouchableOpacity>
      </View>
    </View>
  )

  const dots = (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 8, paddingBottom: 2 }}>
      {[0, 1].map(i => (
        <View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: pageIndex == i ? MX.color.accent : '#4a4a4a' }} />
      ))}
    </View>
  )

  const metaBlock = (compact = false) => {
    const titleBlock = (
      <View style={compact ? { flex: 1 } : undefined}>
        <Text size={compact ? 17 : 19} color={MX.color.text} numberOfLines={1} style={{ fontWeight: '600', letterSpacing: 0.3 }}>{info?.name || '—'}</Text>
        <Text size={11.5} color={MX.color.text3} numberOfLines={1} style={{ marginTop: 4 }}>
          {String([info?.singer, meta?.albumName].filter(Boolean).join(' · '))}
        </Text>
        <Text size={10} color={withAlpha(MX.color.accent, 0.9)} numberOfLines={1} style={{ marginTop: 5, letterSpacing: 0.4 }}>
          {formatText}
        </Text>
      </View>
    )
    if (!compact) {
      return <View style={{ alignItems: 'center', paddingTop: 6, paddingHorizontal: 22 }}>{titleBlock}</View>
    }
    // 横屏：单行（歌名 + 收藏/加入），歌手·专辑·格式移到左栏「信息」，把高度让给封面
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 1, paddingHorizontal: 2 }}>
        <View style={{ flex: 1 }}>
          <Text size={16.5} color={MX.color.text} numberOfLines={1} style={{ fontWeight: '600', letterSpacing: 0.3 }}>{info?.name || '—'}</Text>
        </View>
        <TouchableOpacity activeOpacity={0.6} onPress={toggleLove} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <IconHeart size={22} color={inLove ? MX.color.accent : MX.color.text2} />
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.6} onPress={showAdd} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <IconPlus size={22} color={MX.color.text2} />
        </TouchableOpacity>
      </View>
    )
  }

  const controlsBlock = (showLyricBtn: boolean, compact = false) => {
    // 两列版（手机横屏）：控件按屏幕高度自适应，不写死
    const big = landscape && !isWideScreen
    const pSize = Math.round(Math.max(48, Math.min(76, winH * 0.11)))
    const sSize = Math.round(pSize * 0.60)
    const trackH = Math.round(Math.max(23, Math.min(30, winH * 0.042)))
    // 循环 / 随机固定 40dp；上一首 / 下一首沿用本布局原尺寸，但不小于小键，避免小键比主控键还大
    const sideSize = Math.max(ICON_KEY, big ? sSize : compact ? 32 : ICON_MAIN)
    return (
    <>
      {/* 进度 */}
      <View style={{ paddingHorizontal: compact ? 2 : 22, paddingTop: big ? 4 : compact ? 2 : 4 }}>
        <Slider
          value={seeking ?? progress.progress}
          minimumValue={0}
          maximumValue={1}
          minimumTrackTintColor={MX.color.accent}
          maximumTrackTintColor="#333333"
          thumbTintColor="#ffffff"
          style={{ width: '100%', height: big ? trackH : compact ? 22 : 26 }}
          onValueChange={handleSeek}
          onSlidingComplete={handleSeekEnd}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: -2 }}>
          <Text size={big ? 11 : 10} color={MX.color.text4}>{progress.nowPlayTimeStr}</Text>
          <Text size={big ? 11 : 10} color={MX.color.text4}>{remainText() || progress.maxPlayTimeStr}</Text>
        </View>
      </View>

      {/* 动作（仅竖屏） */}
      {showLyricBtn ? (
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 40, paddingTop: 6 }}>
        {(
          <>
            <TouchableOpacity style={{ alignItems: 'center', gap: 4 }} activeOpacity={0.6} onPress={() => { pagerRef.current?.setPage(1) }}>
              <IconLyrics size={24} color={MX.color.text2} />
              <Text size={9} color={MX.color.text4}>{t('player_lyrics')}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={{ alignItems: 'center', gap: 4 }} activeOpacity={0.6} onPress={toggleLove}>
          <IconHeart size={24} color={inLove ? MX.color.accent : MX.color.text2} />
          <Text size={9} color={MX.color.text4}>{t('player_favorite')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ alignItems: 'center', gap: 4 }} activeOpacity={0.6} onPress={showAdd}>
          <IconPlus size={24} color={MX.color.text2} />
          <Text size={9} color={MX.color.text4}>{t('player_add_to_list')}</Text>
        </TouchableOpacity>
      </View>
      ) : null}

      {/* 主控 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: big ? 6 : compact ? 2 : 20, paddingTop: big ? 2 : compact ? 1 : 10 }}>
        <RepeatBtn size={ICON_KEY} />
        <TouchableOpacity activeOpacity={0.6} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} onPressIn={() => { setFlashBtn(1) }} onPressOut={() => { setFlashBtn(0) }} onPress={() => { void playPrev() }}>
          <IconPrevWide size={sideSize} color={flashBtn == 1 ? MX.color.accent : MX.color.text2} />
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.7} onPress={togglePlay} style={{ width: big ? Math.round(pSize * 1.5) : compact ? 62 : 72, height: big ? Math.round(pSize * 1.25) : compact ? 42 : 56, alignItems: 'center', justifyContent: 'center' }}>
          {isPlay
            ? <IconPauseWide size={big ? pSize : compact ? 44 : ICON_PLAY} color={MX.color.accent} />
            : <IconPlayWide size={big ? pSize : compact ? 44 : ICON_PLAY} color={MX.color.accent} />}
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.6} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} onPressIn={() => { setFlashBtn(2) }} onPressOut={() => { setFlashBtn(0) }} onPress={() => { void playNext() }}>
          <IconNextWide size={sideSize} color={flashBtn == 2 ? MX.color.accent : MX.color.text2} />
        </TouchableOpacity>
        <ShuffleBtn size={ICON_KEY} />
      </View>

      {/* 音量 + EQ（矮屏隐藏，EQ 移进工具条） */}
      {hideVolumeRow ? null : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: big ? 6 : compact ? 2 : 18, paddingTop: big ? 2 : compact ? 2 : 10, paddingBottom: big ? 4 : compact ? 0 : 14 }}>
        <IconVolumeWide size={ICON_KEY} color={MX.color.text3} />
        <Slider
          value={volumeValue}
          minimumValue={0}
          maximumValue={1}
          minimumTrackTintColor={MX.color.accent}
          maximumTrackTintColor="#333333"
          thumbTintColor="#ffffff"
          style={{ flex: 1, height: big ? Math.round(trackH * 0.9) : compact ? 22 : 26 }}
          onValueChange={v => { setVolumeDraft(v); void setVolume(v) }}
          onSlidingComplete={v => { setVolumeDraft(null); updateSetting({ 'player.volume': v }) }}
        />
        <TouchableOpacity onPress={() => { setEqOpen(true) }} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
          <IconEqLetter size={ICON_KEY} color={MX.color.accent} />
        </TouchableOpacity>
      </View>)}
    </>
    )
  }

  const pager = (pad: number) => (
    <PagerView
      ref={pagerRef}
      style={{ flex: 1 }}
      onPageSelected={e => { setPageIndex(e.nativeEvent.position) }}
    >
      <View key="cover" style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: pad }}>
        <Image
          url={pic}
          style={{
            width: '100%',
            aspectRatio: 1,
            borderRadius: 2,
            ...( { shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 18, shadowOffset: { width: 0, height: 12 } } as any ),
          }}
        />
      </View>
      <View key="lyric" collapsable={false}>
        {pageIndex == 1 ? <LyricView variant="vertical" /> : null}
      </View>
    </PagerView>
  )

  /* ------------------------------ 布局 ------------------------------ */

  // 两列版（手机横屏）：左栏 42%，播放栏 / 工具条按屏幕高度自适应
  const landLeftW = Math.round(winW * 0.42)
  // 播放栏高度跟着界面字号走，否则特大字号下音量行会被挤出屏幕
  const uiScale = useSettingValue('mx.uiScale')
  const scaleK = uiScale == 'large' ? 1.12 : uiScale == 'xlarge' ? 1.25 : 1
  const dockRatio = scaleK > 1 ? 0.46 : 0.40   // 标准字号保持原比例，放大后才给播放栏让高度
  const carDockH = Math.round(Math.min(260, Math.max(132, winH * dockRatio) * scaleK))
  const carStripH = Math.round(Math.max(52, Math.min(78, winH * 0.13)))
  // 队列抽屉宽度（车机 1280 上约 440，够放 5 行歌名）
  const queueW = Math.min(440, Math.round(winW * 0.42))
  // 手机 / 平板横屏三栏（原有布局，勿动）
  const landSideW = Math.round(winW * 0.30)
  const landMidW = Math.round(winW * 0.34)
  // 横屏封面：用封面容器实测剩余空间，控件再变也不会算错
  const coverSize = landscape ? Math.max(72, Math.min(coverBox.w, coverBox.h) - 4) : 0

  return (
    <View style={{ flex: 1, backgroundColor: MX.color.app }}>
      {pic
        ? (
          <RNImage
            source={{ uri: pic }}
            blurRadius={26}
            resizeMode="cover"
            style={{ position: 'absolute', left: -12, right: -12, top: -12, bottom: -12, opacity: 0.42 }}
          />
          )
        : null}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(8,8,9,0.55)' }} />

      <View style={{ flex: 1 }}>
        {header}
        {
          landscape
            ? !isWideScreen
              ? (
              <View style={{ flex: 1, flexDirection: 'row', paddingTop: statusBarHeight }}>
                {/* 车机 · 左 2/5：封面 + 播放控件 */}
                <View style={{ width: landLeftW, paddingHorizontal: 18, paddingTop: 12 }}>
                  <View
                    style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
                    onLayout={e => {
                      const { width, height } = e.nativeEvent.layout
                      if (Math.abs(width - coverBox.w) > 1 || Math.abs(height - coverBox.h) > 1) setCoverBox({ w: width, h: height })
                    }}
                  >
                    <Image
                      url={pic}
                      style={{
                        width: coverSize,
                        height: coverSize,
                        borderRadius: 2,
                        ...( { shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } } as any ),
                      }}
                    />
                  </View>
                  <View style={{ height: carDockH, justifyContent: 'flex-start', paddingTop: 8 }}>
                    {metaBlock(true)}
                    {controlsBlock(false, true)}
                  </View>
                </View>

                {/* 右 3/8：工具条 + 歌词常驻（队列走右侧抽屉） */}
                <View style={{ flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(255,255,255,0.08)' }}>
                  <View style={{ height: carStripH, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
                    <TouchableOpacity
                      onPress={close}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(70,170,255,0.18)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(70,170,255,0.55)' }}
                    >
                      <IconReturnWide size={16} color={MX.color.accent} strokeWidth={2} />
                      <Text size={13.5} color={MX.color.accent}>{t('back')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { setQueueOpen(true) }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' }}
                    >
                      <IconList size={14} color="rgba(255,255,255,0.75)" />
                      <Text size={13.5} color="rgba(255,255,255,0.78)">{t('player_queue')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={showAdd}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' }}
                    >
                      <IconPlus size={14} color="rgba(255,255,255,0.75)" />
                      <Text size={13.5} color="rgba(255,255,255,0.78)">{t('player_add_list')}</Text>
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                    {hideVolumeRow
                      ? (
                        <TouchableOpacity onPress={() => { setEqOpen(true) }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                          <IconEqLetter size={ICON_KEY} color={MX.color.accent} />
                        </TouchableOpacity>
                        )
                      : null}
                    <TouchableOpacity onPress={() => { setSleepOpen(true) }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <IconClock size={21} color={sleep.minutes ? MX.color.accent : MX.color.text2} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setMenuOpen(true) }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <IconMore size={21} color={MX.color.text2} />
                    </TouchableOpacity>
                  </View>
                  <View style={{ flex: 1 }}>
                    <LyricView variant="horizontal" />
                  </View>
                </View>
              </View>
              )
              : (
              <View style={{ flex: 1, flexDirection: 'row', paddingTop: statusBarHeight }}>
                {/* 手机 / 平板 · 左：队列 / 信息 / 音效（原有布局） */}
                <View style={{ width: landSideW, paddingTop: 34, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(255,255,255,0.08)' }}>
                  <SidePanel
                    width={landSideW}
                    meta={{ name: String(info?.name ?? ''), singer: String(info?.singer ?? ''), album: String(meta?.albumName ?? ''), ext, isNas, path: filePath, fileName }}
                    spec={spec}
                    onOpenEq={() => { setEqOpen(true) }}
                    onOpenSleep={() => { setSleepOpen(true) }}
                  />
                </View>

                {/* 中：封面 + 播放控件 */}
                <View style={{ width: landMidW, paddingHorizontal: 16, paddingBottom: 10 }}>
                  <View
                    style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
                    onLayout={e => {
                      const { width, height } = e.nativeEvent.layout
                      if (Math.abs(width - coverBox.w) > 1 || Math.abs(height - coverBox.h) > 1) setCoverBox({ w: width, h: height })
                    }}
                  >
                    <Image
                      url={pic}
                      style={{
                        width: coverSize,
                        height: coverSize,
                        borderRadius: 2,
                        ...( { shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } } as any ),
                      }}
                    />
                  </View>
                  {metaBlock(true)}
                  {controlsBlock(false, true)}
                </View>

                {/* 右：歌词常驻 */}
                <View style={{ flex: 1, paddingTop: 34, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(255,255,255,0.08)' }}>
                  <LyricView variant="horizontal" />
                </View>
              </View>
              )
            : (
              <>
                {pager(14)}
                {dots}
                {pageIndex == 0 ? metaBlock() : null}
                {pageIndex == 0 ? controlsBlock(true) : null}
              </>
              )
        }
      </View>

      {/* 队列抽屉（横屏从右侧滑出，点遮罩关闭） */}
      {queueOpen && landscape && !isWideScreen
        ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' }}>
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => { setQueueOpen(false) }} />
            <View style={{ width: queueW, backgroundColor: 'rgba(14,14,15,0.98)', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(255,255,255,0.12)', paddingTop: statusBarHeight, paddingBottom: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 16 }}>
                <Text size={16} color="#ffffff">{t('player_queue')}</Text>
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={() => { setQueueOpen(false) }} hitSlop={12} style={{ padding: 4 }}>
                  <IconClose size={18} color="rgba(255,255,255,0.7)" />
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <SidePanel
                  width={queueW}
                  meta={{ name: String(info?.name ?? ''), singer: String(info?.singer ?? ''), album: String(meta?.albumName ?? ''), ext, isNas, path: filePath, fileName }}
                  spec={spec}
                  onOpenEq={() => { setQueueOpen(false); setEqOpen(true) }}
                  onOpenSleep={() => { setQueueOpen(false); setSleepOpen(true) }}
                />
              </View>
            </View>
          </View>
          )
        : null}

      <SettingPopup ref={settingPopupRef} direction={landscape ? 'horizontal' : 'vertical'} />
      <MusicAddModal ref={addModalRef} />
      <EqModal visible={eqOpen} onClose={() => { setEqOpen(false) }} />

      <MxActionSheet
        visible={menuOpen}
        title={t('player_menu')}
        items={[
          { key: 'lyricSearch', label: t('player_menu_lyric_search'), onPress: () => { setLyricSearchOpen(true) } },
          { key: 'lyricOffset', label: t('player_menu_lyric_offset'), onPress: () => { setOffsetOpen(true) } },
          { key: 'songInfo', label: t('player_menu_song_info'), onPress: () => { setInfoOpen(true) } },
          { key: 'artistInfo', label: t('player_menu_artist_info'), onPress: () => { setArtistOpen(true) } },
          { key: 'playerSetting', label: t('player_menu_player_setting'), onPress: () => { settingPopupRef.current?.show() } },
        ]}
        onClose={() => { setMenuOpen(false) }}
      />

      <InfoModal visible={infoOpen} onClose={() => { setInfoOpen(false) }} />
      <ArtistModal visible={artistOpen} onClose={() => { setArtistOpen(false) }} />
      <LyricSearchModal visible={lyricSearchOpen} onClose={() => { setLyricSearchOpen(false) }} />
      <LyricOffsetModal
        visible={offsetOpen}
        onClose={() => { setOffsetOpen(false) }}
        onSearch={() => { setOffsetOpen(false); setLyricSearchOpen(true) }}
      />

      <MxActionSheet
        visible={sleepOpen}
        title={t('setting_r_sleep')}
        items={[0, 15, 30, 60, 90].map(v => ({
          key: `${v}`,
          label: v ? t(`setting_r_sleep_${v}` as any) : t('setting_r_off'),
          onPress: () => { if (v) setSleepTimer(v); else clearSleepTimer() },
        }))}
        onClose={() => { setSleepOpen(false) }}
      />
    </View>
  )
})
