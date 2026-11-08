/**
 * 横屏左栏面板：队列 / 信息 / 音效
 * - 队列：当前播放列表（playMusicInfo.listId），点击换歌
 * - 信息：格式、采样率/位深/码率、专辑、文件路径
 * - 音效：音量、EQ 入口、睡眠定时
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, ScrollView, TouchableOpacity, View } from 'react-native'
import Slider from '@react-native-community/slider'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { IconList, IconInfo, IconEq, IconVolumeWide } from '@/components/mx/Icons'
import { usePlayMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { getListMusics } from '@/core/list'
import { playListById } from '@/core/player/player'
import { setVolume, setPlaybackRate } from '@/plugins/player'
import { updateSetting } from '@/core/common'
import { getSleepTimer, subscribeSleepTimer } from '@/core/player/sleepTimer'
import { useI18n, getMessage } from '@/lang'

type Tab = 'queue' | 'info' | 'fx'

const HAIRLINE = 0.5
/** 队列行固定高度：固定了才能用 getItemLayout 精确滚到指定行 */
const ROW_H = 52
// 左栏在黑底上要够亮，灰阶整体抬两档
const L_SUB = '#a6a6a6'
const L_LABEL = '#b8b8b8'
const L_VAL = '#efefef'
const L_PATH = '#dcdcdc'
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

export type SidePanelMeta = {
  name?: string
  singer?: string
  album?: string
  ext?: string
  isNas?: boolean
  path?: string
  fileName?: string
}

const TABS: Array<{ id: Tab, label: string, icon: any }> = [
  { id: 'queue', label: getMessage('side_queue'), icon: IconList },
  { id: 'info', label: getMessage('side_info'), icon: IconInfo },
  { id: 'fx', label: getMessage('side_fx'), icon: IconEq },
]

const fmtTime = (v: any) => {
  const s = String(v ?? '')
  return /^\d{1,2}:\d{2}/.test(s) ? s : ''
}

export default memo(({
  width,
  meta,
  spec,
  onOpenEq,
  onOpenSleep,
}: {
  width: number
  meta: SidePanelMeta
  spec: { sampleRate: number, bits: number, bitrate: number } | null
  onOpenEq: () => void
  onOpenSleep: () => void
}) => {
  const t = useI18n()
  const playMusicInfo = usePlayMusicInfo()
  const listId = (playMusicInfo as any)?.listId as string | null | undefined
  const currentId = String((playMusicInfo as any)?.musicInfo?.id ?? '')
  const [tab, setTab] = useState<Tab>('queue')
  const [queue, setQueue] = useState<LX.Music.MusicInfo[]>([])
  const listRef = useRef<FlatList<LX.Music.MusicInfo>>(null)
  /** 队列可视高度：用来算首尾留白，让第一首和最后一首也能停在正中 */
  const [listH, setListH] = useState(0)
  /** 实测行高：字体设置会改变实际行高，写死值会让居中偏移漂移 */
  const [rowH, setRowH] = useState(ROW_H)
  const volume = useSettingValue('player.volume')
  const playRate = useSettingValue('player.playbackRate') || 1
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null)
  const [, forceTick] = useState(0)

  useEffect(() => subscribeSleepTimer(() => { forceTick(v => v + 1) }), [])

  // 队列只随「列表」变化重载。以前依赖 currentId，切一首歌就清空重填 FlatList，
  // 滚动位置一起被重置，用户看到的就是「点一首歌队列就跳回顶端」。
  useEffect(() => {
    let alive = true
    const load = () => {
      if (!listId) {
        setQueue([])
        return
      }
      void getListMusics(listId).then(list => {
        if (alive) setQueue([...list])
      }).catch(() => {})
    }
    load()
    const onUpdate = (ids: string[]) => {
      if (listId && ids.includes(listId)) load()
    }
    global.app_event.on('myListMusicUpdate', onUpdate)
    return () => {
      alive = false
      global.app_event.off('myListMusicUpdate', onUpdate)
    }
  }, [listId])

  const activeIndex = useMemo(
    () => queue.findIndex(m => String(m.id) == currentId),
    [queue, currentId],
  )

  /** 队列可视高度换算出的首尾留白：让第一首和最后一首也能停在正中 */
  const pad = Math.max(0, Math.round(listH / 2 - rowH / 2))

  // 当前播放的歌停在队列正中；切歌后自动跟随
  useEffect(() => {
    if (activeIndex < 0 || !queue.length || !listH) return
    const offset = Math.max(0, Math.round(pad + rowH * activeIndex - (listH - rowH) / 2))
    const timer = setTimeout(() => {
      try {
        listRef.current?.scrollToOffset({ offset, animated: true })
      } catch {}
    }, 80)
    return () => clearTimeout(timer)
  }, [activeIndex, queue.length, listH, pad, rowH])

  const sleep = getSleepTimer()

  const infoRows = useMemo(() => {
    const rows: Array<[string, string]> = []
    const fmt: string[] = []
    if (meta.ext) fmt.push(meta.ext)
    if (spec?.sampleRate) fmt.push(`${(spec.sampleRate / 1000).toFixed(1).replace('.0', '')} kHz`)
    if (spec?.bits) fmt.push(`${spec.bits} bit`)
    if (spec?.bitrate) fmt.push(`${Math.round(spec.bitrate / 1000)} kbps`)
    rows.push([t('side_format'), fmt.length ? fmt.join(' · ') : '—'])
    rows.push([t('side_source'), meta.isNas ? t('side_nas_network') : t('side_local_file')])
    if (meta.fileName) rows.push([t('side_file'), meta.fileName])
    rows.push([t('side_album'), meta.album || '—'])
    rows.push([t('side_artist'), meta.singer || '—'])
    return rows
  }, [meta, spec])

  const renderQueue = () => {
    if (!listId) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
          <Text size={12} color={L_SUB} style={{ textAlign: 'center' }}>{t('side_no_playlist')}</Text>
        </View>
      )
    }
    if (!queue.length) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text size={12} color={L_SUB}>{t('side_list_empty')}</Text>
        </View>
      )
    }
    const padLocal = pad
    return (
      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={queue}
        keyExtractor={item => String(item.id)}
        showsVerticalScrollIndicator={false}
        onLayout={e => { setListH(e.nativeEvent.layout.height) }}
        getItemLayout={(_, index) => ({ length: rowH, offset: padLocal + rowH * index, index })}
        // 首尾留半个视口的空白：第一首和最后一首也能滚到正中
        contentContainerStyle={{ paddingTop: pad, paddingBottom: pad }}
        renderItem={({ item, index }) => {
          const active = String(item.id) == currentId
          const interval = fmtTime((item as any).interval)
          const sub = String([(item as any).singer, (item as any).meta?.albumName].filter(Boolean).join(' · '))
          return (
            <TouchableOpacity
              activeOpacity={0.65}
              onPress={() => { if (!active && listId) void playListById(listId, String(item.id)) }}
              onLayout={index === 0
                ? (e) => {
                    const h = Math.round(e.nativeEvent.layout.height)
                    if (h > 0 && Math.abs(h - rowH) > 0.5) setRowH(h)
                  }
                : undefined}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                height: ROW_H,
                paddingHorizontal: 12,
                backgroundColor: active ? MX.color.accentDim : 'transparent',
              }}
            >
              <Text size={10.5} color={active ? MX.color.accent : L_SUB} numberOfLines={1} style={{ width: 24, textAlign: 'right' }}>{index + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text size={12.5} color={active ? MX.color.accent : MX.color.text} numberOfLines={1} style={{ fontWeight: active ? '600' : '400' }}>{item.name}</Text>
                {sub ? (
                  <Text size={10} color={L_SUB} numberOfLines={1} style={{ marginTop: 2 }}>{sub}</Text>
                ) : null}
              </View>
              {interval ? <Text size={10} color={L_SUB}>{interval}</Text> : null}
            </TouchableOpacity>
          )
        }}
      />
    )
  }

  const renderInfo = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 6, paddingBottom: 18 }}>
      <Text size={14.5} color={MX.color.text} numberOfLines={2} style={{ fontWeight: '600' }}>{meta.name || '—'}</Text>
      <View style={{ height: 10 }} />
      {infoRows.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6, borderBottomWidth: HAIRLINE, borderBottomColor: MX.color.lineSoft }}>
          <Text size={11} color={L_LABEL} style={{ width: 52 }}>{k}</Text>
          <Text size={11.5} color={L_VAL} style={{ flex: 1 }}>{v}</Text>
        </View>
      ))}
      {meta.path ? (
        <View style={{ paddingTop: 12 }}>
          <Text size={11} color={L_LABEL}>{t('side_path')}</Text>
          <Text size={11.5} color={L_PATH} style={{ marginTop: 5, lineHeight: 18 }}>{meta.path}</Text>
        </View>
      ) : null}
    </ScrollView>
  )

  const renderFx = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <IconVolumeWide size={17} color={MX.color.text3} />
          <Text size={11.5} color={L_VAL}>{t('side_volume')}</Text>
        </View>
        <Text size={10.5} color={L_SUB}>{Math.round((volumeDraft ?? volume ?? 1) * 100)}</Text>
      </View>
      <Slider
        value={volumeDraft ?? volume ?? 1}
        minimumValue={0}
        maximumValue={1}
        minimumTrackTintColor={MX.color.accent}
        maximumTrackTintColor="#333333"
        thumbTintColor="#ffffff"
        style={{ width: '100%', height: 28 }}
        onValueChange={v => { setVolumeDraft(v); void setVolume(v) }}
        onSlidingComplete={v => { setVolumeDraft(null); updateSetting({ 'player.volume': v }) }}
      />

      <View style={{ height: 1, backgroundColor: MX.color.lineSoft, marginVertical: 10 }} />

      <Text size={11.5} color={L_VAL} style={{ marginBottom: 8 }}>{t('side_rate')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'nowrap', gap: 5 }}>
        {RATES.map(r => {
          const on = Math.abs(Number(playRate) - r) < 0.01
          return (
            <TouchableOpacity
              key={r}
              activeOpacity={0.7}
              onPress={() => {
                updateSetting({ 'player.playbackRate': r })
                void setPlaybackRate(r)
              }}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 6,
                borderRadius: MX.radius.card,
                backgroundColor: on ? MX.color.accentDim : MX.color.circle,
              }}
            >
              <Text size={10.5} color={on ? MX.color.accent : L_SUB}>{String(r).replace(/^0\./, '.')}x</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <View style={{ height: 1, backgroundColor: MX.color.lineSoft, marginVertical: 10 }} />

      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onOpenEq}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconEq size={17} color={MX.color.accent} />
          <Text size={12} color={MX.color.text}>{t('side_eq')}</Text>
        </View>
        <Text size={11} color={MX.color.accent}>{t('side_open')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onOpenSleep}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}
      >
        <Text size={12} color={MX.color.text}>{t('side_sleep')}</Text>
        <Text size={11} color={sleep.minutes ? MX.color.accent : L_SUB}>{sleep.minutes ? t('side_sleep_min', { n: sleep.minutes }) : t('side_sleep_off')} ›</Text>
      </TouchableOpacity>
    </ScrollView>
  )

  return (
    <View style={{ width, flex: 1 }}>
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingTop: 2, paddingBottom: 8 }}>
        {TABS.map(({ id, label, icon: Icon }) => {
          const on = tab == id
          return (
            <TouchableOpacity
              key={id}
              activeOpacity={0.7}
              onPress={() => { setTab(id) }}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                height: 28,
                borderRadius: MX.radius.card,
                backgroundColor: on ? MX.color.accentDim : 'transparent',
              }}
            >
              <Icon size={14} color={on ? MX.color.accent : MX.color.text4} />
              <Text size={11.5} color={on ? MX.color.accent : '#a8a8a8'}>{label}</Text>
            </TouchableOpacity>
          )
        })}
      </View>
      <View style={{ flex: 1 }}>
        {tab == 'queue' ? renderQueue() : tab == 'info' ? renderInfo() : renderFx()}
      </View>
    </View>
  )
})

