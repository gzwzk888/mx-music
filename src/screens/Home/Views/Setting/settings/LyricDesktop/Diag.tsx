import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lang'
import { TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { toast } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import {
  checkDesktopLyricOverlayPermission,
  hideDesktopLyric,
  openDesktopLyricOverlayPermissionActivity,
  setDesktopLyricPosition,
  showDesktopLyric,
} from '@/core/desktopLyric'

/**
 * 桌面歌词自检：把「权限 / 显示 / 位置」三件事摊开，方便定位为什么看不到
 */
export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const isEnable = useSettingValue('desktopLyric.enable')
  const [permitted, setPermitted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checkPermission = useCallback(async() => {
    try {
      await checkDesktopLyricOverlayPermission()
      setPermitted(true)
    } catch {
      setPermitted(false)
    }
  }, [])

  useEffect(() => {
    void checkPermission()
    timerRef.current = setInterval(() => { void checkPermission() }, 3000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [checkPermission])

  const handleGrant = useCallback(() => {
    void openDesktopLyricOverlayPermissionActivity()
  }, [])

  const handleRetry = useCallback(async() => {
    setBusy(true)
    try {
      await checkDesktopLyricOverlayPermission()
      await showDesktopLyric()
      updateSetting({ 'desktopLyric.enable': true })
      toast(t('diag_shown'))
    } catch (e: any) {
      toast(`显示失败：${e?.message ?? t('diag_unknown')}`)
      void checkPermission()
    } finally {
      setBusy(false)
    }
  }, [checkPermission])

  const handleResetPosition = useCallback(async() => {
    updateSetting({
      'desktopLyric.position.x': 0,
      'desktopLyric.position.y': 0,
    })
    try {
      await setDesktopLyricPosition(0, 0)
      toast(t('diag_pos_reset'))
    } catch {
      toast(t('diag_pos_fail'))
    }
  }, [])

  const handleHide = useCallback(async() => {
    try {
      await hideDesktopLyric()
    } catch {}
    updateSetting({ 'desktopLyric.enable': false })
    toast(t('diag_closed'))
  }, [])

  const permText = permitted === null ? t('diag_checking') : permitted ? t('diag_granted') : t('diag_not_granted')

  return (
    <View style={styles.wrap}>
      <Text size={12} color={theme['c-350']} style={styles.line}>
        {t('diag_overlay_perm')}{permText}
      </Text>
      <Text size={12} color={theme['c-350']} style={styles.line}>
        {t('diag_current')}{isEnable ? '已开启' : '已关闭'}　（需正在播放且有歌词才会显示文字）
      </Text>

      <View style={styles.btnRow}>
        {permitted !== true
          ? <TouchableOpacity style={[styles.btn, { borderColor: theme['c-primary'] }]} onPress={handleGrant}>
            <Text size={12} color={theme['c-primary']}>{t('diag_grant')}</Text>
          </TouchableOpacity>
          : null}
        <TouchableOpacity style={[styles.btn, { borderColor: theme['c-border-background'] }]} disabled={busy} onPress={() => { void handleRetry() }}>
          <Text size={12} color={theme['c-font']}>{busy ? t('diag_working') : t('diag_reshow')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { borderColor: theme['c-border-background'] }]} onPress={() => { void handleResetPosition() }}>
          <Text size={12} color={theme['c-font']}>{t('diag_reset_pos')}</Text>
        </TouchableOpacity>
        {isEnable
          ? <TouchableOpacity style={[styles.btn, { borderColor: theme['c-border-background'] }]} onPress={() => { void handleHide() }}>
            <Text size={12} color={theme['c-font']}>关闭</Text>
          </TouchableOpacity>
          : null}
      </View>

      <Text size={11} color={theme['c-400']} style={styles.hint}>
        {t('diag_tip')} 还需在「应用信息 → 权限 → 特殊权限」里额外允许悬浮窗；若之前把歌词条拖到屏幕外，点「重置位置」可找回。
      </Text>
    </View>
  )
})

const styles = createStyle({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
  },
  line: {
    lineHeight: 18,
  },
  btnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  hint: {
    marginTop: 8,
    lineHeight: 16,
  },
})
