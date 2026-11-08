/**
 * 设置页（Onkyo 风格）
 * 一屏五组：播放 / 曲库 / 显示 / 歌词 / 其他
 * 只保留真正有效的开关；桌面歌词、备份、关于 用二级页复用旧实现。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, Switch, TextInput, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { MxActionSheet, MxTopBar, type MxActionItem } from '@/components/mx'
import { MX_BUILD } from '@/config/constant'
import {
  coverCacheStats, getCoverDir, isCoverCacheAvailable, pickCoverDir, resetThumbMemCache, setCoverDir,
} from '@/core/local/coverCache'
import { clearCoverCache } from '@/core/local/coverCache'
import { IconChevronRight } from '@/components/mx/Icons'
import { useWindowSize } from '@/utils/hooks'
import { useSettingValue } from '@/store/setting/hook'
import { setLanguage, updateSetting } from '@/core/common'
import { langList, useI18n } from '@/lang'
import { pickImageFile } from '@/utils/nativeModules/mediaScan'
import { setPlaybackRate } from '@/plugins/player'
import { clearSleepTimer, getSleepTimer, setSleepTimer, subscribeSleepTimer } from '@/core/player/sleepTimer'
import LyricDesktopSettings from '../settings/LyricDesktop'
import BackupSettings from '../settings/Backup'
import About from '../settings/About'

type SheetState = { title: string, items: MxActionItem[] } | null

const RATE_LIST = [0.75, 1, 1.25, 1.5] as const
const SLEEP_LIST = [0, 15, 30, 60, 90] as const

/* -------------------------------- 行组件 -------------------------------- */

const Row = ({ title, sub, right, onPress, last }: {
  title: string
  sub?: string
  right?: React.ReactNode
  onPress?: () => void
  last?: boolean
}) => {
  const inner = (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingLeft: MX.space.page,
      paddingRight: MX.space.page,
      paddingVertical: 12,
      minHeight: 52,
      borderBottomWidth: last ? 0 : 0.5,
      borderBottomColor: MX.color.lineSoft,
    }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={14} color={MX.color.text} numberOfLines={1}>{title}</Text>
        {sub ? <Text size={MX.font.rowSub} color={MX.color.text3} numberOfLines={2} style={{ marginTop: 2, lineHeight: 15 }}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  )
  if (!onPress) return inner
  return <TouchableOpacity activeOpacity={0.6} onPress={onPress}>{inner}</TouchableOpacity>
}

const ToggleRow = ({ title, sub, k, last, onChange }: {
  title: string
  sub?: string
  k: keyof LX.AppSetting
  last?: boolean
  onChange?: (v: boolean, update: (v: boolean) => void) => void
}) => {
  const value = useSettingValue(k) as boolean
  return (
    <Row
      title={title}
      sub={sub}
      last={last}
      right={
        <Switch
          value={!!value}
          trackColor={{ false: '#3a3a3a', true: MX.color.accent }}
          thumbColor="#ffffff"
          onValueChange={v => {
            if (onChange) onChange(v, nv => { updateSetting({ [k]: nv } as any) })
            else updateSetting({ [k]: v } as any)
          }}
        />
      }
    />
  )
}

const ValueRow = ({ title, sub, value, onPress, last }: {
  title: string
  sub?: string
  value: string
  onPress: () => void
  last?: boolean
}) => (
  <Row
    title={title}
    sub={sub}
    last={last}
    onPress={onPress}
    right={
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text size={MX.font.row} color={MX.color.accent}>{value}</Text>
        <IconChevronRight size={14} color={MX.color.text4} />
      </View>
    }
  />
)

const OpacityRow = () => {
  const t = useI18n()
  const value = useSettingValue('theme.customBgOpacity')
  const [text, setText] = useState(String(Math.round((value ?? 0.45) * 100)))
  useEffect(() => { setText(String(Math.round((value ?? 0.45) * 100))) }, [value])

  const commit = () => {
    const n = Math.min(100, Math.max(1, Math.round(Number(text) || 0)))
    setText(String(n))
    updateSetting({ 'theme.customBgOpacity': n / 100 } as any)
  }

  return (
    <Row
      title={t('setting_r_bg_opacity')}
      sub={t('setting_r_bg_opacity_tip')}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <TextInput
            value={text}
            onChangeText={v => { setText(v.replace(/[^0-9]/g, '').slice(0, 3)) }}
            onBlur={commit}
            onSubmitEditing={commit}
            keyboardType="number-pad"
            selectTextOnFocus
            maxLength={3}
            style={{
              minWidth: 44,
              padding: 0,
              textAlign: 'right',
              color: MX.color.text,
              fontSize: MX.font.row,
            }}
          />
          <Text size={MX.font.row} color={MX.color.text2}>%</Text>
        </View>
      }
    />
  )
}

const Group = ({ title, children }: { title: string, children: React.ReactNode }) => (
  <View style={{ marginTop: 18 }}>
    <Text size={14} color={MX.color.accent} style={{ letterSpacing: 1, paddingHorizontal: MX.space.page, paddingBottom: 7, fontWeight: '700' }}>{title}</Text>
    <View style={{ backgroundColor: 'rgba(22,22,22,0.72)', borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: MX.color.line }}>
      {children}
    </View>
  </View>
)

/* --------------------------------- 页面 --------------------------------- */

type SubPage = 'lyric' | 'backup' | 'about' | null

export default () => {
  const t = useI18n()
  const { width } = useWindowSize()
  const wide = width >= 700
  const [sub, setSub] = useState<SubPage>(null)
  const [sheet, setSheet] = useState<SheetState>(null)
  const [msg, setMsg] = useState('')
  const [picking, setPicking] = useState(false)
  const [, forceTick] = useState(0)
  const [coverDir, setCoverDirInfo] = useState<{ kind: string, dir: string }>({ kind: 'private', dir: '' })
  const [coverStat, setCoverStat] = useState<{ count: number, bytes: number }>({ count: 0, bytes: 0 })
  const [coverBusy, setCoverBusy] = useState('')

  const customBg = useSettingValue('theme.customBg')
  const rate = useSettingValue('player.playbackRate')
  const addType = useSettingValue('list.addMusicLocationType')
  const langId = useSettingValue('common.langId')
  const accent = useSettingValue('mx.accentColor')
  const uiScale = useSettingValue('mx.uiScale')

  useEffect(() => subscribeSleepTimer(() => { forceTick(v => v + 1) }), [])

  const loadCoverInfo = useCallback(async() => {
    if (!isCoverCacheAvailable()) return
    const [d, st] = await Promise.all([getCoverDir(), coverCacheStats()])
    setCoverDirInfo(d)
    setCoverStat({ count: st.count, bytes: st.bytes })
  }, [])

  useEffect(() => { void loadCoverInfo() }, [loadCoverInfo])

  const sleep = getSleepTimer()

  const langName = useMemo(() => langList.find(l => l.locale == langId)?.name ?? '简体中文', [langId])
  const accentName = accent == 'yellow' ? t('setting_accent_yellow') : accent == 'orange' ? t('setting_accent_orange') : t('setting_accent_blue')
  const uiScaleName = uiScale == 'large' ? t('setting_ui_scale_large') : uiScale == 'xlarge' ? t('setting_ui_scale_xlarge') : t('setting_ui_scale_standard')

  const coverDirName = useMemo(() => {
    if (coverDir.kind == 'external') return t('setting_cover_dir_external')
    if (coverDir.kind == 'saf') return t('setting_cover_dir_custom')
    return t('setting_cover_dir_private')
  }, [coverDir.kind, t])

  const coverSizeText = useMemo(() => {
    const mb = coverStat.bytes / 1048576
    return `${coverStat.count} · ${mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(coverStat.bytes / 1024)}KB`}`
  }, [coverStat])

  const chooseCoverDir = async() => {
    setCoverBusy('pick')
    try {
      const dir = await pickCoverDir()
      if (dir) {
        resetThumbMemCache()
        await loadCoverInfo()
        setMsg(t('setting_cover_dir_changed'))
      }
    } catch (e: any) {
      setMsg(`${t('setting_cover_dir_fail')}：${e?.message ?? e}`)
    } finally {
      setCoverBusy('')
    }
  }

  const pickBg = async() => {
    if (picking) return
    setPicking(true)
    setMsg('')
    try {
      const uri = await pickImageFile()
      if (uri) updateSetting({ 'theme.customBg': uri } as any)
    } catch (e: any) {
      setMsg(`${t('setting_r_bg_failed')}：${e?.message ?? e}`)
    } finally {
      setPicking(false)
    }
  }

  const back = () => {
    if (sub) {
      setSub(null)
      return
    }
    if (!wide) global.app_event.changeMenuVisible(true)
  }

  /* ------------------------------ 二级页 ------------------------------ */

  if (sub) {
    const titles: Record<string, string> = {
      lyric: t('setting_r_lyric_desktop'),
      backup: t('setting_r_backup'),
      about: t('setting_r_about'),
    }
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <MxTopBar title={titles[sub]} left="back" onLeftPress={() => { setSub(null) }} />
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {sub == 'lyric' ? <LyricDesktopSettings /> : null}
          {sub == 'backup' ? <BackupSettings /> : null}
          {sub == 'about' ? <About /> : null}
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <MxTopBar
        title={t('nav_setting')}
        left={wide ? 'none' : 'menu'}
        onLeftPress={back}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* 播放 */}
        <Group title={t('setting_group_play')}>
          <ToggleRow title={t('setting_r_save_time')} k="player.isSavePlayTime" />
          <ValueRow
            title={t('setting_r_play_rate')}
            value={`${Number(rate).toFixed(2).replace(/0$/, '')}×`}
            onPress={() => {
              setSheet({
                title: t('setting_r_play_rate'),
                items: RATE_LIST.map(v => ({
                  key: `${v}`,
                  label: `${v}×`,
                  onPress: () => {
                    updateSetting({ 'player.playbackRate': v } as any)
                    void setPlaybackRate(v).catch(() => {})
                  },
                })),
              })
            }}
          />
          <ValueRow
            title={t('setting_r_sleep')}
            value={sleep.minutes ? t(`setting_r_sleep_${sleep.minutes}` as any) : t('setting_r_off')}
            onPress={() => {
              setSheet({
                title: t('setting_r_sleep'),
                items: SLEEP_LIST.map(v => ({
                  key: `${v}`,
                  label: v ? t(`setting_r_sleep_${v}` as any) : t('setting_r_off'),
                  onPress: () => { if (v) setSleepTimer(v); else clearSleepTimer() },
                })),
              })
            }}
          />
          <ToggleRow title={t('setting_r_audio_focus')} sub={t('setting_r_audio_focus_sub')} k="player.isHandleAudioFocus" />
          <ToggleRow title={t('setting_r_auto_clean')} k="player.isAutoCleanPlayedList" last />
        </Group>

        {/* 显示 */}
        <Group title={t('setting_group_display')}>
          <ValueRow
            title={t('setting_ui_scale')}
            value={uiScaleName}
            onPress={() => {
              setSheet({
                title: t('setting_ui_scale'),
                items: [
                  { key: 'standard', label: t('setting_ui_scale_standard'), onPress: () => { updateSetting({ 'mx.uiScale': 'standard' }) } },
                  { key: 'large', label: t('setting_ui_scale_large'), onPress: () => { updateSetting({ 'mx.uiScale': 'large' }) } },
                  { key: 'xlarge', label: t('setting_ui_scale_xlarge'), onPress: () => { updateSetting({ 'mx.uiScale': 'xlarge' }) } },
                ],
              })
            }}
          />
          <ValueRow
            title={t('setting_basic_theme_accent')}
            value={accentName}
            onPress={() => {
              setSheet({
                title: t('setting_basic_theme_accent'),
                items: [
                  { key: 'blue', label: t('setting_accent_blue'), onPress: () => { updateSetting({ 'mx.accentColor': 'blue' }) } },
                  { key: 'yellow', label: t('setting_accent_yellow'), onPress: () => { updateSetting({ 'mx.accentColor': 'yellow' }) } },
                  { key: 'orange', label: t('setting_accent_orange'), onPress: () => { updateSetting({ 'mx.accentColor': 'orange' }) } },
                ],
              })
            }}
          />
          <ValueRow
            title={t('setting_r_bg_image')}
            sub={msg || undefined}
            value={picking ? '…' : (customBg ? t('setting_r_bg_set') : t('setting_r_bg_none'))}
            onPress={() => {
              setSheet({
                title: t('setting_r_bg_image'),
                items: [
                  { key: 'pick', label: t('setting_bg_image_pick'), onPress: () => { void pickBg() } },
                  ...(customBg ? [{ key: 'clear', label: t('setting_bg_image_clear'), danger: true, onPress: () => { updateSetting({ 'theme.customBg': null } as any) } }] : []),
                ],
              })
            }}
          />
          <OpacityRow />
          <ToggleRow
            title={t('setting_local_online_cover')}
            sub={t('setting_local_online_cover_sub')}
            k="mx.localOnlineCover"
          />
          <ToggleRow title={t('setting_r_album_name')} k="list.isShowAlbumName" />
          <ToggleRow title={t('setting_r_interval')} k="list.isShowInterval" />
          <ToggleRow title={t('setting_r_click_play')} k="list.isClickPlayList" />
          <ValueRow
            title={t('setting_r_add_location')}
            value={addType == 'top' ? t('setting_list_add_music_location_type_top') : t('setting_list_add_music_location_type_bottom')}
            onPress={() => {
              setSheet({
                title: t('setting_r_add_location'),
                items: [
                  { key: 'top', label: t('setting_list_add_music_location_type_top'), onPress: () => { updateSetting({ 'list.addMusicLocationType': 'top' }) } },
                  { key: 'bottom', label: t('setting_list_add_music_location_type_bottom'), onPress: () => { updateSetting({ 'list.addMusicLocationType': 'bottom' }) } },
                ],
              })
            }}
          />
          <ToggleRow title={t('setting_r_nav_back')} k="common.showBackBtn" />
          <ToggleRow title={t('setting_r_nav_exit')} k="common.showExitBtn" last />
        </Group>

        {/* 歌词 */}
        <Group title={t('setting_group_lyric')}>
          <ValueRow title={t('setting_r_lyric_desktop')} value="" onPress={() => { setSub('lyric') }} />
          <ToggleRow title={t('setting_r_lyric_s2t')} k="player.isS2t" last />
        </Group>

        {/* 其他 */}
        <Group title={t('setting_group_other')}>
          <ValueRow
            title={t('setting_r_language')}
            value={langName}
            onPress={() => {
              setSheet({
                title: t('setting_r_language'),
                items: langList.map(l => ({ key: l.locale, label: l.name, onPress: () => { setLanguage(l.locale) } })),
              })
            }}
          />
          <ValueRow title={t('setting_r_about')} value="" onPress={() => { setSub('about') }} last />
        </Group>

        <View style={{ paddingTop: 22, alignItems: 'center' }}>
          {picking ? <ActivityIndicator size="small" color={MX.color.accent} /> : null}
          <Text size={MX.font.caption} color={MX.color.text4}>{t('app_build')} {MX_BUILD}</Text>
        </View>
      </ScrollView>

      <MxActionSheet visible={!!sheet} title={sheet?.title} items={sheet?.items ?? []} onClose={() => { setSheet(null) }} />
    </View>
  )
}
