/**
 * 11 段均衡器（真实生效：处理在播放器的音频处理链里）
 * 预设集对照 WiiM Home App 的 24 个预设：名称与频段走向按 WiiM 官方说明文档
 * (faq.wiimhome.com 24 Preset EQ Settings) 一一对应；
 * 具体 dB 数值为该项目按描述自行标定（WiiM 官方不公开每段数值，只存在于设备内）。
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Switch, TouchableOpacity, View } from 'react-native'
import Slider from '@react-native-community/slider'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { IconChevronDown } from '@/components/mx/Icons'
import { useStatusbarHeight } from '@/store/common/hook'
import { getEqState, resetEq, setEqAll, setEqEnabled, setEqGain, setEqPreamp } from '@/utils/nativeModules/mxEq'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'

const FREQS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000]
const FLAT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

type Preset = { key: string, name: string, en: string, gains: number[], preamp: number }

// 常用 EQ —— WiiM Home App 的 10 个预设，数值为用户截图逐段读取的实拍值（32k 沿用 16k）
const PRESETS_COMMON: Preset[] = [
  { key: 'flat', name: '平坦', en: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },
  { key: 'acoustic', name: '原声', en: 'Acoustic', gains: [5, 4.9, 4, 1, 2.2, 1.8, 3.5, 4.1, 3.5, 2.2, 2.2], preamp: -2.5 },
  { key: 'classical', name: '古典', en: 'Classical', gains: [4.8, 3.8, 3, 2.5, -1.5, -1.5, 0, 2.2, 3.2, 3.8, 3.8], preamp: -2.5 },
  { key: 'deep', name: '深沉', en: 'Deep', gains: [4.9, 3.5, 1.8, 1, 2.8, 2.5, 1.5, -2.2, -3.5, -4.6, -4.6], preamp: -2.5 },
  { key: 'jazz', name: '爵士', en: 'Jazz', gains: [4, 3, 1.5, 2.2, -1.5, -1.5, 0, 1.5, 3, 3.8, 3.8], preamp: -2 },
  { key: 'pop', name: '流行', en: 'Pop', gains: [-1.5, -1, 0, 2, 4, 4, 2, 0, -1, 1.5, 1.5], preamp: -2 },
  { key: 'rnb', name: '节奏蓝调', en: 'R&B', gains: [2.6, 6.9, 5.7, 1.3, -2.2, -1.5, 2.3, 2.7, 3, 3.8, 3.8], preamp: -3.5 },
  { key: 'small_spk', name: '小音箱', en: 'Small Speakers', gains: [5.5, 4.2, 3.5, 2.5, 1.2, 0, -1.2, -2.5, -3.5, -4.2, -4.2], preamp: -2.5 },
  { key: 'treble_boost', name: '高音增强', en: 'Treble Booster', gains: [0, 0, 0, 0, 0, 1.2, 2.5, 3.5, 4.2, 5.5, 5.5], preamp: -2.5 },
  { key: 'vocal_boost', name: '人声增强', en: 'Vocal Booster', gains: [-1.5, -3, -3, 1.5, 3.8, 3.8, 3, 1.5, 0, -1.5, -1.5], preamp: -2 },
]

// 特色艺人 —— Onkyo HF Player 附带的艺人曲线（assets/Featured_EQ/<艺人>/*.plist），
// 按对数频率插值到 11 段。一位艺人有几首作品就有几条曲线
const ARTISTS: Array<{ key: string, name: string, nameEn?: string, note: string, noteEn?: string, items: Preset[] }> = [
  {
    key: 'ian', name: 'Scott Ian', note: 'Anthrax · 鞭击金属', noteEn: 'Anthrax · Thrash metal',
    items: [
      { key: 'ian_1', name: 'Scott Ian EQ', en: 'Scott Ian EQ', gains: [3.3, 4.4, 5.1, 5, 3.4, 1.7, 1.7, 2.3, 3.2, 3.5, 3.4], preamp: -3 },
    ],
  },
  {
    key: 'leo', name: 'Leo Nocentelli', note: 'The Meters · 放克', noteEn: 'The Meters · Funk',
    items: [
      { key: 'ln_1', name: '1 Hey Pocky Way', en: 'Hey Pocky Way', gains: [12, 11.6, 11.1, 8.1, 4.7, 6.5, 12, 11.8, 10.9, 6.6, 11.6], preamp: -6.5 },
      { key: 'ln_2', name: "2 It Ain't No Use", en: "It Ain't No Use", gains: [12, 10.5, 11, 8.9, 9.2, 7.2, 8.6, 9.9, 10.9, 3.5, 11.2], preamp: -6.5 },
      { key: 'ln_3', name: '3 Just Kissed My Baby', en: 'Just Kissed My Baby', gains: [11.7, 2, 12, 12, 10, 10.8, 11.7, 11.3, 1.9, 6.4, 11.9], preamp: -6.5 },
      { key: 'ln_4', name: '4 People Say', en: 'People Say', gains: [9.7, 8.5, 6.3, 6.5, 7.6, 7.9, 7.7, 8.8, 8.8, 6.7, 5.4], preamp: -5.5 },
    ],
  },
  {
    key: 'tim', name: 'Tim Lopez', note: "Plain White T's · 流行朋克", noteEn: "Plain White T's · Pop punk",
    items: [
      { key: 'tl_1', name: "1 Haven't Told Her", en: "Haven't Told Her", gains: [4.2, 1.5, 4, 6.3, 7.3, 7.2, 5, 6.1, 5.4, 5.2, 1.3], preamp: -4.5 },
      { key: 'tl_2', name: '2 Helium', en: 'Helium', gains: [4, 1.6, 2.2, 4.1, 6.2, 5.5, 4.1, 2.7, 2.9, -0.9, 0], preamp: -3.5 },
      { key: 'tl_3', name: "3 Should've Gone to Bed", en: "Should've Gone to Bed", gains: [0.6, 0.5, -0.4, 2.7, 3.4, 3.8, 4.2, 4.6, 1, 0.8, 1.8], preamp: -3 },
      { key: 'tl_4', name: '4 The Giving Tree', en: 'The Giving Tree', gains: [3.9, 4.7, 4, 1.2, 2, 3.5, 3.4, 3.4, 3.8, 7.2, 6.3], preamp: -4 },
    ],
  },
  {
    key: 'buck', name: 'Buckcherry', note: '美式硬摇滚', noteEn: 'American hard rock',
    items: [
      { key: 'bc_1', name: '1 Buckcherry 1', en: 'Buckcherry 1', gains: [-0.2, 1.1, 2.5, 2.3, 1.2, 2.6, 2.1, -0.9, 0.1, 2.6, 2.6], preamp: -2 },
      { key: 'bc_2', name: '2 Buckcherry 2', en: 'Buckcherry 2', gains: [0.5, 1.7, 1.6, 0.6, 0, -0.3, 0.4, 1.2, 1.3, 1.1, 0.9], preamp: -1.5 },
    ],
  },
  {
    key: 'st', name: 'Strange Talk', note: '澳洲电音流行', noteEn: 'Australian electropop',
    items: [
      { key: 'st_1', name: 'Strange Talk EQ', en: 'Strange Talk EQ', gains: [0, 1, 1.3, 0.4, -0.2, 0.6, 1.5, 2.9, 2.8, 1.9, 0], preamp: -2 },
    ],
  },
  // 以下三位为用户提供的参数（非 Onkyo 原厂资源）：蔡琴按频段描述映射到 11 段，童丽/赵鹏为 10 段原值 + 32k 补值
  {
    key: 'caiqin', name: '蔡琴', nameEn: 'Cai Qin', note: '发烧女声 · 中音磁性', noteEn: 'Audiophile vocal · warm midrange',
    items: [
      { key: 'cq_1', name: '中音王者', en: 'Vocal King', gains: [1, 1.5, 1, -2, 0, 2.5, 0.5, 0.5, 0, 0, 0], preamp: -1 },
    ],
  },
  {
    key: 'tongli', name: '童丽', nameEn: 'Tong Li', note: '发烧女声 · 甜美柔润', noteEn: 'Audiophile vocal · sweet and silky',
    items: [
      { key: 'tongli_1', name: '甜美柔润', en: 'Sweet & Soft', gains: [1, 2, 1, -1, 2, 3, 2, -2, 2, 3, 2], preamp: -1.5 },
    ],
  },
  {
    key: 'zhaopeng', name: '赵鹏', nameEn: 'Zhao Peng', note: '男低音 · 磁性低音炮', noteEn: 'Male bass · magnetic low end',
    items: [
      { key: 'zhaopeng_1', name: '磁性低音', en: 'Deep Male Vocal', gains: [3, 5, 4, 1, 2, 0, 2, 3, 1, 2, 1], preamp: -2.5 },
    ],
  },
]

const sameCurve = (p: Preset, g: number[], pre: number) =>
  p.gains.every((v, i) => Math.abs((g[i] ?? 0) - v) < 0.05) && Math.abs(pre - p.preamp) < 0.05

const fmtFreq = (f: number) => f >= 1000 ? `${f % 1000 == 0 ? f / 1000 : (f / 1000).toFixed(1)}k` : `${f}`
const fmtGain = (g: number) => (g > 0 ? `+${g.toFixed(1)}` : g.toFixed(1))

export default memo(({ visible, onClose }: { visible: boolean, onClose: () => void }) => {
  const t = useI18n()
  const langId = useSettingValue('common.langId')
  const isEn = String(langId ?? '').startsWith('en')
  const statusBarHeight = useStatusbarHeight()
  const [enabled, setEnabled] = useState(false)
  const [preamp, setPreamp] = useState(0)
  const [gains, setGains] = useState<number[]>(FLAT)
  const [frames, setFrames] = useState(0)
  const [group, setGroup] = useState<'common' | 'artist'>('common')
  const [artistKey, setArtistKey] = useState('leo')

  useEffect(() => {
    if (!visible) return
    void getEqState().then(state => {
      if (!state) return
      setEnabled(state.enabled)
      setPreamp(state.preamp)
      setGains(state.gains?.length ? state.gains : FLAT)
      setFrames(state.processedFrames ?? 0)
      // 默认定位：当前曲线若属于某位艺人，直接停在那位艺人（而不是上次查看记录）
      const cur = state.gains?.length ? state.gains : FLAT
      const hit = ARTISTS.find(a => a.items.some(p => sameCurve(p, cur, state.preamp)))
      if (hit) {
        setArtistKey(hit.key)
        setGroup('artist')
      }
    })
  }, [visible])

  const toggleEnabled = useCallback((v: boolean) => {
    setEnabled(v)
    void setEqEnabled(v)
  }, [])

  const changeBand = useCallback((index: number, value: number) => {
    setGains(prev => {
      const next = prev.slice()
      next[index] = value
      return next
    })
  }, [])

  const commitBand = useCallback((index: number, value: number) => {
    void setEqGain(index, value)
  }, [])

  const applyPreset = useCallback((preset: Preset) => {
    setGains(preset.gains.slice())
    setPreamp(preset.preamp)
    if (!enabled) {
      setEnabled(true)
      void setEqAll(preset.gains, true, preset.preamp)
    } else {
      void setEqAll(preset.gains, true, preset.preamp)
    }
  }, [enabled])

  const applyArtist = useCallback((a: typeof ARTISTS[number]) => {
    setArtistKey(a.key)
    const first = a.items[0]
    if (first) applyPreset(first)
  }, [applyPreset])

  const doReset = useCallback(() => {
    setGains(FLAT)
    setPreamp(0)
    void resetEq()
  }, [])

  const activeCount = useMemo(() => gains.filter(g => Math.abs(g) > 0.05).length, [gains])

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: MX.color.app, paddingTop: statusBarHeight }}>
        {/* 顶栏 */}
        <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 }}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <IconChevronDown size={22} color={MX.color.text} />
          </TouchableOpacity>
          <Text size={15} color={MX.color.text} style={{ flex: 1, textAlign: 'center', fontWeight: '600', letterSpacing: 0.5 }}>{t('eq_title')}</Text>
          <Switch
            value={enabled}
            onValueChange={toggleEnabled}
            trackColor={{ false: '#333', true: MX.color.accent }}
            thumbColor="#fff"
          />
        </View>

        {/* 分组 */}
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 6 }}>
          {([['common', t('eq_group_common')], ['artist', t('eq_group_artist')]] as Array<[string, string]>).map(([id, label]) => {
            const on = group == id
            return (
              <TouchableOpacity
                key={id}
                activeOpacity={0.7}
                onPress={() => { setGroup(id as 'common' | 'artist') }}
                style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: on ? MX.color.accentDim : 'transparent' }}
              >
                <Text size={11} color={on ? MX.color.accent : '#9a9a9a'} style={{ letterSpacing: 0.5 }}>{label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {group == 'common'
          ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, height: 44 }}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16, alignItems: 'center', paddingBottom: 8 }}
            >
              {PRESETS_COMMON.map(p => {
                const on = p.gains.every((g, i) => Math.abs((gains[i] ?? 0) - g) < 0.05) && Math.abs(preamp - p.preamp) < 0.05
                return (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => { applyPreset(p) }}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: on ? MX.color.accent : '#2a2a2a',
                      backgroundColor: on ? MX.color.accentDim : '#161616',
                    }}
                  >
                    <Text size={11.5} color={on ? MX.color.accent : '#d0d0d0'}>{isEn ? (p.en || p.name) : p.name}</Text>
                  </TouchableOpacity>
                )
              })}
              <TouchableOpacity
                onPress={doReset}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#2a2a2a' }}
              >
                <Text size={11.5} color="#a6a6a6">{t('eq_reset')}</Text>
              </TouchableOpacity>
            </ScrollView>
          )
          : (
            <>
              {/* 第一行：艺人 */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0, height: 42 }}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 16, alignItems: 'center' }}
              >
                {ARTISTS.map(a => {
                  const on = artistKey == a.key
                  return (
                    <TouchableOpacity
                      key={a.key}
                      activeOpacity={0.7}
                      onPress={() => { applyArtist(a) }}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: on ? MX.color.accent : '#2a2a2a',
                        backgroundColor: on ? MX.color.accentDim : '#161616',
                      }}
                    >
                      <Text size={11.5} color={on ? MX.color.accent : '#d0d0d0'}>{isEn ? (a.nameEn || a.name) : a.name}</Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>

              {/* 第二行：该艺人名下的 EQ */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0, height: 42 }}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 32, alignItems: 'center', paddingBottom: 8 }}
              >
                {(ARTISTS.find(a => a.key == artistKey)?.items ?? []).map(p => {
                  const on = p.gains.every((g, i) => Math.abs((gains[i] ?? 0) - g) < 0.05) && Math.abs(preamp - p.preamp) < 0.05
                  return (
                    <TouchableOpacity
                      key={p.key}
                      onPress={() => { applyPreset(p) }}
                      style={{
                        paddingHorizontal: 11, paddingVertical: 6, borderRadius: 14,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: on ? MX.color.accent : '#2a2a2a',
                        backgroundColor: on ? MX.color.accentDim : '#161616',
                      }}
                    >
                      <Text size={11} color={on ? MX.color.accent : '#c8c8c8'}>{isEn ? (p.en || p.name) : p.name}</Text>
                    </TouchableOpacity>
                  )
                })}
                <TouchableOpacity
                  onPress={doReset}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#2a2a2a' }}
                >
                  <Text size={11.5} color="#a6a6a6">{t('eq_reset')}</Text>
                </TouchableOpacity>
              </ScrollView>
            </>
          )}

        {/* 频段 */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}>
          {FREQS.map((f, i) => (
            <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 }}>
              <Text size={11} color={MX.color.text3} style={{ width: 46 }}>{fmtFreq(f)}</Text>
              <Slider
                value={gains[i] ?? 0}
                minimumValue={-12}
                maximumValue={12}
                step={0.5}
                minimumTrackTintColor={MX.color.accent}
                maximumTrackTintColor="#2e2e2e"
                thumbTintColor="#ffffff"
                style={{ flex: 1, height: 30 }}
                disabled={!enabled}
                onValueChange={v => { changeBand(i, v) }}
                onSlidingComplete={v => { commitBand(i, v) }}
              />
              <Text size={11} color={enabled ? MX.color.accent : MX.color.text4} style={{ width: 40, textAlign: 'right' }}>{fmtGain(gains[i] ?? 0)}</Text>
            </View>
          ))}

          <View style={{ height: 1, backgroundColor: '#242424', marginVertical: 10 }} />

          {/* 预增益 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text size={11} color={MX.color.text3} style={{ width: 58 }}>{t('eq_preamp')}</Text>
            <Slider
              value={preamp}
              minimumValue={-12}
              maximumValue={12}
              step={0.5}
              minimumTrackTintColor={MX.color.accent}
              maximumTrackTintColor="#2e2e2e"
              thumbTintColor="#ffffff"
              style={{ flex: 1, height: 30 }}
              disabled={!enabled}
              onValueChange={v => { setPreamp(v) }}
              onSlidingComplete={v => { void setEqPreamp(v) }}
            />
            <Text size={11} color={enabled ? MX.color.accent : MX.color.text4} style={{ width: 40, textAlign: 'right' }}>{fmtGain(preamp)}</Text>
          </View>

          <Text size={10} color={MX.color.text4} style={{ marginTop: 16, lineHeight: 16 }}>{t('eq_tip')}</Text>
        </ScrollView>
      </View>
    </Modal>
  )
})
