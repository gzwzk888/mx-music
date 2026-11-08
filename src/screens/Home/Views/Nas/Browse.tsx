/**
 * 家庭音乐共享 · 浏览页
 * 顶栏返回 + 面包屑 + 目录/曲目列表 + 底部播放全部；右上「⋯」进高级。
 */
import { FlatList, TouchableOpacity, View } from 'react-native'
import { useEffect, useRef } from 'react'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { useI18n } from '@/lang'
import { MxTopBar, MxSongRow, MxEmpty, MxBadge } from '@/components/mx'
import { IconChevronRight, IconFolder, IconMore, IconPlay, IconScan, IconRefresh } from '@/components/mx/Icons'
import type { NasItem } from '@/core/nas/dlna'

export interface Crumb { id: string, title: string }

/**
 * 每个目录的滚动位置（按 crumbs 路径做 key）。
 * 放在模块级：切 tab / 组件重挂载时也不会丢，返回上级能回到刚才那一屏。
 */
const browseOffsets = new Map<string, number>()

interface Props {
  deviceName: string
  host: string
  crumbs: Crumb[]
  items: NasItem[]
  total: number
  loading: boolean
  hasMore: boolean
  playableCount: number
  /** 索引 / CUE 结论，一行小字 */
  note: string
  /** 读取失败的原因：以前失败只显示空白，看不出是网络、解析还是权限问题 */
  message?: string
  onUp: () => void
  /** 根目录再按返回 = 回到设备列表 */
  onExit: () => void
  onCrumb: (index: number) => void
  onOpen: (item: NasItem) => void
  onPlay: (item?: NasItem) => void
  onLoadMore: () => void
  onAdvanced: () => void
  /** 重建 NAS 全库索引 */
  onRebuildIndex: () => void
}

export default ({
  deviceName, host, crumbs, items, total, loading, hasMore, playableCount, note, message,
  onUp, onExit, onCrumb, onOpen, onPlay, onLoadMore, onAdvanced, onRebuildIndex,
}: Props) => {
  const t = useI18n()
  const title = crumbs[crumbs.length - 1]?.title ?? deviceName
  const listRef = useRef<FlatList<NasItem>>(null)
  /** 当前目录路径 key：crumbs 的 id 串起来，同一目录永远是同一个 key */
  const pathKey = crumbs.map(c => c.id).join('/')
  const restoredKey = useRef<string | null>(null)
  /** 恢复阶段标记：到了才理会 onContentSizeChange，恢复完就清掉，避免干扰后续手动滚动 */
  const pendingKey = useRef<string | null>(null)

  // 返回上级 / 进入子目录后回到这一屏原来的位置。
  // 只在数据到位时恢复一次；绝不在 onScroll 里写回（挂载瞬间会派发一次 0，会把记忆冲掉）
  useEffect(() => {
    if (restoredKey.current === pathKey) return
    const saved = browseOffsets.get(pathKey)
    if (saved == null || saved <= 0) {
      restoredKey.current = pathKey
      return
    }
    if (!items.length) return
    restoredKey.current = pathKey
    pendingKey.current = pathKey
    let alive = true
    let tries = 0
    // FlatList 首帧只渲染 initialNumToRender 项，contentSize 还很小，
    // 直接 scrollToOffset 会被裁到当时的最大可滚位置 → 边滚边等渲染，直到到位或超时
    const tick = () => {
      if (!alive) return
      listRef.current?.scrollToOffset({ offset: saved, animated: false })
      tries++
      if (tries < 30) setTimeout(tick, 120)
      else if (pendingKey.current === pathKey) pendingKey.current = null
    }
    const timer = setTimeout(tick, 40)
    return () => { alive = false; clearTimeout(timer) }
  }, [pathKey, items.length])

  /** contentSize 变大（渲染出更多行）时，若还在等恢复位置就再滚一次 */
  useEffect(() => { pendingKey.current = browseOffsets.get(pathKey) ? pathKey : null }, [pathKey])
  const onContentSize = (_w: number, _h: number) => {
    if (pendingKey.current !== pathKey) return
    const target = browseOffsets.get(pathKey)
    if (target == null) return
    listRef.current?.scrollToOffset({ offset: target, animated: false })
  }

  const rememberOffset = (y: number) => { browseOffsets.set(pathKey, y) }
  /** 最近一次滚动位置（只记在 ref 里，用来在点开子目录前把父目录位置存下来） */
  const lastOffset = useRef(0)
  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <MxTopBar
        title={title}
        left="back"
        onLeftPress={crumbs.length > 1 ? onUp : onExit}
        subtitle={deviceName && deviceName != title ? deviceName : host}
        actions={[
          { key: 'rebuild', onPress: onRebuildIndex, node: <IconScan size={MX.size.iconSm} color={MX.color.iconIdle} /> },
          { key: 'more', onPress: onAdvanced, node: <IconMore size={MX.size.iconSm} color={MX.color.iconIdle} /> },
        ]}
      />

      {/* 面包屑（只在有层级时出现） */}
      {crumbs.length > 1
        ? (
          < FlatList
            horizontal
            style={{ flexGrow: 0 }}
            data={crumbs}
            keyExtractor={(c, i) => `${c.id}_${i}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: MX.space.page, paddingVertical: 6, gap: 4, alignItems: 'center' }}
            renderItem={({ item, index }) => {
              const last = index == crumbs.length - 1
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity onPress={() => { if (!last) onCrumb(index) }} disabled={last}>
                    <Text size={MX.font.rowSub} color={last ? MX.color.text : MX.color.text3}>{item.title}</Text>
                  </TouchableOpacity>
                  {last ? null : <IconChevronRight size={12} color={MX.color.text4} />}
                </View>
              )
            }}
          />
          )
        : null}

      {note
        ? <Text size={MX.font.caption} color={MX.color.text4} numberOfLines={1} style={{ paddingHorizontal: MX.space.page, paddingBottom: 6 }}>{note}</Text>
        : null}

      {/* 重新扫描索引：与「本机曲库」同一个位置和样式，不用再去找右上角那个小图标 */}
      {crumbs.length <= 1
        ? (
          <View style={{ flexDirection: 'row', paddingHorizontal: MX.space.page, paddingBottom: 8, gap: 8 }}>
            <TouchableOpacity
              onPress={onRebuildIndex}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 12, paddingVertical: 7,
                borderWidth: 1, borderColor: MX.color.line, borderRadius: 999,
              }}
            >
              <IconRefresh size={14} color={MX.color.text2} />
              <Text size={MX.font.rowSub} color={MX.color.text2}>{t('dirs_rescan')}</Text>
            </TouchableOpacity>
          </View>
          )
        : null}

      {message
        ? <Text size={MX.font.caption} color="#ff6b6b" style={{ paddingHorizontal: MX.space.page, paddingBottom: 6 }}>{message}</Text>
        : null}

      <FlatList
        ref={listRef}
        data={items}
        onContentSizeChange={onContentSize}
        onScroll={e => { lastOffset.current = e.nativeEvent.contentOffset.y }}
        scrollEventThrottle={16}
        onScrollEndDrag={e => { lastOffset.current = e.nativeEvent.contentOffset.y; rememberOffset(lastOffset.current) }}
        onMomentumScrollEnd={e => { lastOffset.current = e.nativeEvent.contentOffset.y; rememberOffset(lastOffset.current) }}
        keyExtractor={item => item.id}
        initialNumToRender={20}
        windowSize={10}
        contentContainerStyle={{ paddingBottom: playableCount ? 84 : 24 }}
        renderItem={({ item }) => {
          if (item.isContainer) {
            return (
              <TouchableOpacity
                activeOpacity={0.62}
                onPress={() => { rememberOffset(lastOffset.current); onOpen(item) }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: MX.space.gap,
                  paddingHorizontal: MX.space.page,
                  paddingVertical: MX.space.row,
                  minHeight: MX.size.rowMin,
                }}
              >
                <View style={{
                  width: MX.size.art,
                  height: MX.size.art,
                  borderRadius: MX.radius.art,
                  backgroundColor: MX.color.circle,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <IconFolder size={MX.size.iconSm} color={MX.color.text2} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text size={MX.font.row} color={MX.color.text} numberOfLines={1}>{item.title}</Text>
                  <Text size={MX.font.rowSub} color={MX.color.text3} numberOfLines={1} style={{ marginTop: 1 }}>
                    {item.childCount ? t('brw_items', { n: item.childCount }) : t('brw_dir')}
                  </Text>
                </View>
                <IconChevronRight size={MX.size.iconSm} color={MX.color.text4} />
              </TouchableOpacity>
            )
          }
          const ext = item.ext.toUpperCase()
          const sub = [item.artist, item.album].filter(Boolean).join(' · ')
          return (
            <MxSongRow
              art={item.artUrl || null}
              coverPath={item.url}
              title={item.title}
              sub={sub || item.protocolInfo}
              duration={item.interval}
              badge={ext || null}
              badgeTone="plain"
              onPress={() => onPlay(item)}
            />
          )
        }}
        ListFooterComponent={hasMore
          ? (
            <TouchableOpacity
              onPress={onLoadMore}
              disabled={loading}
              style={{ marginTop: 10, marginHorizontal: MX.space.page, paddingVertical: 12, alignItems: 'center', borderRadius: MX.radius.card, backgroundColor: MX.color.circle }}
            >
              <Text size={MX.font.row} color={MX.color.text2}>
                {loading ? t('brw_loading') : t('brw_more', { n: items.length, total })}
              </Text>
            </TouchableOpacity>
            )
          : null}
        ListEmptyComponent={loading ? null : <MxEmpty text={t('brw_empty')} />}
      />

      {playableCount
        ? (
          <View style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: MX.space.page,
            paddingTop: 8,
            paddingBottom: 14,
            backgroundColor: 'rgba(16,16,16,0.92)',
            borderTopWidth: 0.5,
            borderTopColor: MX.color.line,
          }}>
            <TouchableOpacity
              onPress={() => onPlay()}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                height: 46,
                borderRadius: 23,
                backgroundColor: MX.color.accent,
              }}
            >
              <IconPlay size={18} color="#08131f" />
              <Text size={MX.font.section} color="#08131f">播放全部 {playableCount} 首</Text>
            </TouchableOpacity>
          </View>
          )
        : null}
    </View>
  )
}
