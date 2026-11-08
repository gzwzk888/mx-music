/**
 * 播放页歌词视图（新样式）
 * - 支持设置里的歌词字号（竖屏/横屏两套）与对齐方式
 * - 自动滚动到当前行（手动滚动后 4 秒内不抢），点行跳转
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, TouchableOpacity, View, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { useLrcPlay, useLrcSet, type Line } from '@/plugins/lyric'
import { useSettingValue } from '@/store/setting/hook'
import { setCurrentTime } from '@/plugins/player'
import { useI18n } from '@/lang'

export default memo(({ variant = 'vertical' }: { variant?: 'vertical' | 'horizontal' }) => {
  const t = useI18n()
  const lines = useLrcSet()
  const { line: activeLine } = useLrcPlay()
  const align = useSettingValue('playDetail.style.align')
  const fsV = useSettingValue('playDetail.vertical.style.lrcFontSize')
  const fsH = useSettingValue('playDetail.horizontal.style.lrcFontSize')
  // 歌词行距（70%~220%，100% = 原样）
  const lrcLineSpace = useSettingValue('playDetail.style.lrcLineSpace')
  const listRef = useRef<FlatList<Line>>(null)
  const manualUntil = useRef(0)
  const [listH, setListH] = useState(0)

  // 设置里字号是千分比（210 → 21dp）
  const base = Math.max(10, ((variant == 'horizontal' ? fsH : fsV) || 210) / 10)
  const textAlign = align == 'left' ? 'left' : align == 'right' ? 'right' : 'center'
  // 行距百分比 → 额外上下留白（随字号缩放；100% 时与原来一致）
  const spaceScale = Math.max(50, Math.min(300, lrcLineSpace || 100)) / 100
  // 行高与上下留白一起缩放，100% 时与旧版视觉一致
  const lineHeightScale = 1 + (spaceScale - 1) * 0.3
  const linePad = Math.max(0, base * 0.09 * spaceScale) + Math.max(0, base * (spaceScale - 1) * 0.45)

  useEffect(() => {
    if (!lines.length || !listH) return
    if (Date.now() < manualUntil.current) return
    const index = Math.min(Math.max(activeLine, 0), lines.length - 1)
    try {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.45, animated: true })
    } catch {}
  }, [activeLine, lines.length, listH])

  const onScrollBegin = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    manualUntil.current = Date.now() + 4000
  }, [])

  if (!lines.length) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text size={13} color={MX.color.text4}>{t('player_lyric_empty')}</Text>
      </View>
    )
  }

  return (
    <FlatList
      ref={listRef}
      data={lines}
      keyExtractor={(item, i) => `${i}_${item.time}`}
      showsVerticalScrollIndicator={false}
      onLayout={e => { setListH(e.nativeEvent.layout.height) }}
      onScrollBeginDrag={onScrollBegin}
      contentContainerStyle={{ paddingVertical: Math.max(24, listH * 0.36) }}
      ListHeaderComponent={<View style={{ height: 8 }} />}
      ListFooterComponent={<View style={{ height: 40 }} />}
      onScrollToIndexFailed={info => {
        listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })
      }}
      renderItem={({ item, index }) => {
        const active = index == activeLine
        return (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => { if (item.time != null) void setCurrentTime(item.time) }}
            style={{ paddingHorizontal: 26, paddingVertical: linePad }}
          >
            <Text
              size={active ? base * 1.06 : base * 0.94}
              color={active ? MX.color.accent : MX.color.text4}
              style={{
                lineHeight: base * (active ? 1.3 : 1.22) * lineHeightScale,
                fontWeight: active ? '600' : '400',
                textAlign,
              }}
            >
              {item.text || ' '}
            </Text>
          </TouchableOpacity>
        )
      }}
    />
  )
})
