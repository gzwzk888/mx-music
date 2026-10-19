import { memo, useCallback, useEffect, useRef, useState } from 'react'
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
      toast('已请求显示桌面歌词，回桌面看看')
    } catch (e: any) {
      toast(`显示失败：${e?.message ?? '未知原因'}`)
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
      toast('位置已重置到左上角')
    } catch {
      toast('重置位置失败')
    }
  }, [])

  const handleHide = useCallback(async() => {
    try {
      await hideDesktopLyric()
    } catch {}
    updateSetting({ 'desktopLyric.enable': false })
    toast('已关闭桌面歌词')
  }, [])

  const permText = permitted === null ? '检测中…' : permitted ? '已授权' : '未授权（看不到歌词多半是这里）'

  return (
    <View style={styles.wrap}>
      <Text size={12} color={theme['c-350']} style={styles.line}>
        悬浮窗权限：{permText}
      </Text>
      <Text size={12} color={theme['c-350']} style={styles.line}>
        当前设置：{isEnable ? '已开启' : '已关闭'}　（需正在播放且有歌词才会显示文字）
      </Text>

      <View style={styles.btnRow}>
        {permitted !== true
          ? <TouchableOpacity style={[styles.btn, { borderColor: theme['c-primary'] }]} onPress={handleGrant}>
            <Text size={12} color={theme['c-primary']}>去授予权限</Text>
          </TouchableOpacity>
          : null}
        <TouchableOpacity style={[styles.btn, { borderColor: theme['c-border-background'] }]} disabled={busy} onPress={() => { void handleRetry() }}>
          <Text size={12} color={theme['c-font']}>{busy ? '处理中…' : '重新显示'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { borderColor: theme['c-border-background'] }]} onPress={() => { void handleResetPosition() }}>
          <Text size={12} color={theme['c-font']}>重置位置</Text>
        </TouchableOpacity>
        {isEnable
          ? <TouchableOpacity style={[styles.btn, { borderColor: theme['c-border-background'] }]} onPress={() => { void handleHide() }}>
            <Text size={12} color={theme['c-font']}>关闭</Text>
          </TouchableOpacity>
          : null}
      </View>

      <Text size={11} color={theme['c-400']} style={styles.hint}>
        三星/国产 ROM 还需在「应用信息 → 权限 → 特殊权限」里额外允许悬浮窗；若之前把歌词条拖到屏幕外，点「重置位置」可找回。
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
