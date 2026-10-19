import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Modal, PanResponder, StyleSheet, TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import { createStyle } from '@/utils/tools'
import { formatLyricOffset, getLyricOffset, resetLyricOffset, shiftLyricOffset } from '@/core/lyricOffset'

const STEPS: Array<{ label: string, ms: number }> = [
  { label: '-3s', ms: -3000 },
  { label: '-1s', ms: -1000 },
  { label: '-0.5s', ms: -500 },
  { label: '+0.5s', ms: 500 },
  { label: '+1s', ms: 1000 },
  { label: '+3s', ms: 3000 },
]

/** 偏移展示：<1 分钟显示秒，≥1 分钟显示 m/s */
const formatOffset = formatLyricOffset

/**
 * 歌词同步微调：点一次累加一次（+3s 点两次 = +6s）
 * 面板可拖动，不遮挡歌词也不会锁住屏幕
 */
export default ({ visible, onClose, onSearch }: { visible: boolean, onClose: () => void, onSearch?: () => void }) => {
  const theme = useTheme()
  const playMusicInfo = usePlayMusicInfo()
  const id = ((playMusicInfo?.musicInfo ?? {}) as any).id as string | undefined

  const [offset, setOffset] = useState(0)

  const pan = useRef(new Animated.ValueXY()).current
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        pan.setOffset({ x: (pan.x as any)._value, y: (pan.y as any)._value })
        pan.setValue({ x: 0, y: 0 })
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset()
      },
    }),
  ).current

  useEffect(() => {
    if (!visible) return
    pan.setValue({ x: 0, y: 0 })
    setOffset(id ? getLyricOffset(id) : 0)
  }, [visible, id, pan])

  const handleShift = useCallback((ms: number) => {
    if (!id) return
    setOffset(shiftLyricOffset(id, ms))
  }, [id])

  const handleReset = useCallback(() => {
    if (!id) return
    setOffset(resetLyricOffset(id))
  }, [id])

  const renderRow = (steps: Array<{ label: string, ms: number }>, height: number, size: number) => (
    <View style={styles.row}>
      {steps.map(step => (
        <TouchableOpacity
          key={step.label}
          style={[styles.btn, { height, borderColor: theme['c-primary'], backgroundColor: theme['c-primary-background'] }]}
          onPress={() => { handleShift(step.ms) }}
        >
          <Text size={size} color={theme['c-primary']}>{step.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* 透明背板：点空白处关闭，不压暗歌词 */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        <Animated.View
          style={[
            styles.card,
            { backgroundColor: theme['c-content-background'], borderColor: theme['c-border-background'] },
            { transform: pan.getTranslateTransform() },
          ]}
          {...panResponder.panHandlers}
        >
          <View style={styles.head}>
            <Text size={13} color={theme['c-font']}>歌词同步</Text>
            <Text size={13} color={theme['c-primary']} style={styles.value}>{formatOffset(offset)}</Text>
            <Text size={10} color={theme['c-350']} style={styles.dragTip}>可拖动</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={16} color={theme['c-400']} />
            </TouchableOpacity>
          </View>

          {renderRow(STEPS, 44, 15)}

          {Math.abs(offset) >= 5000
            ? <Text size={10} color={theme['c-primary']} style={styles.warn}>偏移已超过 5 秒，可能取到的不是这首歌的歌词版本，建议点「重新搜索歌词」</Text>
            : null}

          <View style={styles.footer}>
            <TouchableOpacity style={[styles.footerBtn, { borderColor: theme['c-border-background'] }]} onPress={handleReset}>
              <Text size={13} color={theme['c-font']}>复位 0s</Text>
            </TouchableOpacity>
            {onSearch
              ? <TouchableOpacity style={[styles.footerBtn, { borderColor: theme['c-primary'] }]} onPress={() => { onSearch() }}>
                <Text size={13} color={theme['c-primary']}>重新搜索歌词</Text>
              </TouchableOpacity>
              : null}
            <Text size={10} color={theme['c-350']} style={styles.hint}>点一次累加，每首歌单独记忆 · 范围 ±60 秒</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = createStyle({
  root: {
    flex: 1,
  },
  card: {
    position: 'absolute',
    top: '14%',
    alignSelf: 'center',
    width: '92%',
    maxWidth: 460,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  value: {
    marginLeft: 8,
    fontWeight: 'bold',
  },
  dragTip: {
    marginLeft: 8,
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  btn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerBtn: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    flexShrink: 1,
  },
  warn: {
    lineHeight: 15,
    marginBottom: 6,
  },
})
