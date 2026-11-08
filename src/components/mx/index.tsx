/**
 * MX 新 UI 基础组件（Onkyo 风格：深色、细线图标、单一强调色）
 * 只服务新页面，不替换项目原有的 common 组件，避免影响未重做的旧页。
 */
import { memo, useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, Modal, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import { useStatusbarHeight } from '@/store/common/hook'
import Text from '@/components/common/Text'
import Image from '@/components/common/Image'
import { MX } from '@/theme/mx'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { getCover } from '@/core/local/dirs'
import {
  IconBack, IconDisc, IconMenu, IconMore, IconNext, IconPause, IconPlay, IconPrev,
} from './Icons'

/* ---------------------------------- 顶栏 ---------------------------------- */

export interface MxTopBarProps {
  title: string
  /** 左侧：menu = 打开抽屉，back = 返回，none = 空 */
  left?: 'menu' | 'back' | 'none'
  onLeftPress?: () => void
  subtitle?: string
  /** 右侧动作，从右往左渲染 */
  actions?: Array<{ key: string, onPress?: () => void, node?: ReactNode }>
  style?: StyleProp<ViewStyle>
}

const circleBtn = {
  width: MX.size.btn,
  height: MX.size.btn,
  borderRadius: MX.size.btn / 2,
  alignItems: 'center',
  justifyContent: 'center',
} as const

export const MxIconButton = ({ onPress, children, active }: {
  onPress?: () => void
  children: ReactNode
  active?: boolean
}) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.6}
    style={[circleBtn, { backgroundColor: active ? MX.color.circleOn : MX.color.circle }]}
  >
    {children}
  </TouchableOpacity>
)

export const MxTopBar = memo(({ title, left = 'none', onLeftPress, subtitle, actions, style }: MxTopBarProps) => {
  const statusBarHeight = useStatusbarHeight()
  const customBg = useSettingValue('theme.customBg')
  return (
    <View style={[{ paddingTop: statusBarHeight, backgroundColor: customBg ? 'rgba(10,10,10,0.62)' : MX.color.app }, style]}>
      <View style={{
        height: MX.size.topBar,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: MX.space.page - 4,
        gap: 10,
      }}>
        {
          left == 'none'
            ? null
            : <MxIconButton onPress={onLeftPress}>
                {left == 'menu' ? <IconMenu size={20} color={MX.color.text} /> : <IconBack size={20} color={MX.color.text} />}
              </MxIconButton>
        }
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text size={MX.font.section} color={MX.color.text} numberOfLines={1} style={{ letterSpacing: 0.5 }}>{title}</Text>
          {subtitle ? <Text size={MX.font.caption} color={MX.color.text3} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {(actions?.length ?? 0) > 0
          ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {actions!.map(a => a.onPress
                ? (
                  <TouchableOpacity
                    key={a.key}
                    onPress={a.onPress}
                    activeOpacity={0.6}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    {a.node ?? <IconMore size={18} color={MX.color.text} />}
                  </TouchableOpacity>
                  )
                : <View key={a.key}>{a.node ?? <MxIconButton><IconMore size={18} color={MX.color.text} /></MxIconButton>}</View>)}
            </View>
          : null}
      </View>
    </View>
  )
})
MxTopBar.displayName = 'MxTopBar'

/* --------------------------------- 顶部 Tab -------------------------------- */

export interface MxTabItem { key: string, label: string }

export const MxTabBar = ({ tabs, activeKey, onChange }: {
  tabs: MxTabItem[]
  activeKey: string
  onChange: (key: string) => void
}) => (
  <View style={{
    flexDirection: 'row',
    gap: 20,
    paddingHorizontal: MX.space.page,
    borderBottomWidth: 1,
    borderBottomColor: MX.color.line,
    backgroundColor: MX.color.app,
  }}>
    {
      tabs.map(tab => {
        const on = tab.key == activeKey
        return (
          <TouchableOpacity key={tab.key} onPress={() => { onChange(tab.key) }} activeOpacity={0.7}>
            <View style={{ paddingVertical: 9 }}>
              <Text size={MX.font.tab} color={on ? MX.color.accent : MX.color.text3}>{tab.label}</Text>
              <View style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 2,
                backgroundColor: on ? MX.color.accent : 'transparent',
              }} />
            </View>
          </TouchableOpacity>
        )
      })
    }
  </View>
)

/* ---------------------------------- 徽标 ---------------------------------- */

export const MxBadge = ({ text, tone = 'accent' }: { text: string, tone?: 'accent' | 'plain' }) => (
  <View style={{
    borderWidth: 1,
    borderColor: tone == 'accent' ? MX.color.accentDim : MX.color.line,
    borderRadius: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
  }}>
    <Text size={MX.font.badge} color={tone == 'accent' ? MX.color.accent : MX.color.text3} style={{ letterSpacing: 0.4 }}>{text}</Text>
  </View>
)

/* ------------------------------ 按需读内嵌封面 ----------------------------- */

/** 本机文件没有 picUrl 时，按需抽内嵌封面（只在实际渲染到这一行时才读） */
const CoverThumb = memo(({ path, size, radius }: { path: string, size: number, radius: number }) => {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void getCover(path).then(cover => { if (alive) setUrl(cover) }).catch(() => {})
    return () => { alive = false }
  }, [path])
  // 外层固定方框 + 图片绝对填充：避免 Image 自身尺寸/内在比例影响布局（文件夹封面尤其明显）
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden' }}>
      <Image url={url} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }} />
    </View>
  )
})
CoverThumb.displayName = 'CoverThumb'

/** 远程封面（NAS）：走 getCover 的远程分支，内嵌封面 → 同目录图片探测 */
const RemoteCover = memo(({ url, size, radius }: { url: string, size: number, radius: number }) => {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setSrc(null)
    setFailed(false)
    void getCover(url).then(cover => { if (alive) setSrc(cover) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [url])
  if (failed) return <Image url={null} style={{ width: size, height: size, borderRadius: radius }} />
  return <Image url={src} style={{ width: size, height: size, borderRadius: radius }} />
})
RemoteCover.displayName = 'RemoteCover'

/* ---------------------------------- 列表行 --------------------------------- */

/**
 * MediaStore 的老封面地址（content://media/external/audio/albumart/<id>）
 * 在 Android 10+ 已经打不开，留着只会显示成占位图；统一当空处理。
 */
export const isDeadAlbumArt = (url?: string | null) =>
  !!url && url.startsWith('content://media/external/audio/albumart')

/** 封面：优先用现成 url（NAS / 在线），没有就从本机文件抽内嵌封面 */
export const MxCover = memo(({ art, path, size, radius }: { art?: string | null, path?: string | null, size: number, radius: number }) => {
  // NAS / 远程：按曲目地址取内嵌封面（→ 同目录图）。
  // 不走 DLNA 的 albumArtURI —— QNAP 给的 Thumbnails 地址对普通客户端一律 404，
  // 直接用它只会得到一个永远失败的图，白白挡住后面的内嵌封面。
  if (path && /^https?:\/\//i.test(path)) return <RemoteCover url={path} size={size} radius={radius} />
  const src = isDeadAlbumArt(art) ? null : art
  if (src) {
    return (
      <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden' }}>
        <Image url={src} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }} />
      </View>
    )
  }
  // 本机文件：CoverThumb（内嵌封面 → 同目录图片）
  if (path && !path.startsWith('http://') && !path.startsWith('https://')) return <CoverThumb path={path} size={size} radius={radius} />
  // NAS / 远程：单独组件，本机路径的逻辑完全不受影响
  if (path) return <RemoteCover url={path} size={size} radius={radius} />
  return <Image url={null} style={{ width: size, height: size, borderRadius: radius }} />
})
MxCover.displayName = 'MxCover'

export interface MxRowProps {
  /** 封面图，null / 空串会落到项目统一的 logo 占位 */
  art?: string | null
  title: string
  sub?: string
  badge?: string | null
  badgeTone?: 'accent' | 'plain'
  /** 时长（如 04:12），显示在徽标右侧 */
  duration?: string | null
  /** 没有 art 时，从这个本机文件抽内嵌封面 */
  coverPath?: string
  active?: boolean
  onPress?: () => void
  onMore?: () => void
  right?: ReactNode
}

export const MxSongRow = memo(({ art, title, sub, badge, badgeTone, duration, coverPath, active, onPress, onMore, right }: MxRowProps) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.62} disabled={!onPress}>
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: MX.space.gap,
      paddingHorizontal: MX.space.page,
      paddingVertical: MX.space.row,
      minHeight: MX.size.rowMin,
      backgroundColor: active ? MX.color.card : 'transparent',
    }}>
      <MxCover art={art} path={coverPath} size={MX.size.art} radius={MX.radius.art} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={MX.font.row} color={active ? MX.color.accent : MX.color.text} numberOfLines={1}>{title}</Text>
        {sub ? <Text size={MX.font.rowSub} color={MX.color.text3} numberOfLines={1} style={{ marginTop: 1 }}>{sub}</Text> : null}
      </View>
      {badge ? <MxBadge text={badge} tone={badgeTone} /> : null}
      {duration ? <Text size={MX.font.rowSub} color={MX.color.text3} style={{ minWidth: 34, textAlign: 'right' }}>{duration}</Text> : null}
      {right ?? null}
      {
        onMore
          ? <TouchableOpacity onPress={onMore} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} activeOpacity={0.6}>
              <IconMore size={16} color={MX.color.text3} />
            </TouchableOpacity>
          : null
      }
    </View>
  </TouchableOpacity>
))
MxSongRow.displayName = 'MxSongRow'

/** 分组标题行（抽屉、列表分组用） */
export const MxSectionLabel = ({ text }: { text: string }) => (
  <View style={{ paddingHorizontal: MX.space.page, paddingTop: 18, paddingBottom: 6 }}>
    <Text size={MX.font.caption} color={MX.color.text4} style={{ letterSpacing: 1.2 }}>{text.toUpperCase()}</Text>
  </View>
)

/* ---------------------------------- 空态 ---------------------------------- */

export const MxEmpty = ({ text, action }: { text: string, action?: ReactNode }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
    <IconDisc size={54} color="#2f2f2f" strokeWidth={1.1} />
    <Text size={MX.font.rowSub} color={MX.color.text3} style={{ textAlign: 'center', lineHeight: 18 }}>{text}</Text>
    {action}
  </View>
)

export const MxLoading = ({ text }: { text?: string }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
    <ActivityIndicator color={MX.color.accent} />
    {text ? <Text size={MX.font.rowSub} color={MX.color.text3}>{text}</Text> : null}
  </View>
)

/* -------------------------------- 迷你播放条 ------------------------------- */

export interface MxMiniBarProps {
  title: string
  sub?: string
  art?: string | null
  isPlay: boolean
  /** 0 - 1 */
  progress?: number
  onPress?: () => void
  onTogglePlay?: () => void
  onNext?: () => void
  onPrev?: () => void
}

export const MxMiniBar = memo(({ title, sub, art, isPlay, progress = 0, onPress, onTogglePlay, onNext, onPrev }: MxMiniBarProps) => (
  <View style={{ backgroundColor: MX.color.mini, borderTopWidth: 1, borderTopColor: MX.color.line }}>
    <View style={{ height: 2, backgroundColor: '#242424' }}>
      <View style={{ height: 2, width: `${Math.max(0, Math.min(1, progress)) * 100}%`, backgroundColor: MX.color.accent }} />
    </View>
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} disabled={!onPress}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: MX.space.page - 4,
        paddingVertical: 8,
      }}>
        <Image url={art ?? null} style={{ width: MX.size.artSm, height: MX.size.artSm, borderRadius: MX.radius.art }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text size={12} color={MX.color.text} numberOfLines={1}>{title}</Text>
          {sub ? <Text size={MX.font.caption} color={MX.color.text3} numberOfLines={1}>{sub}</Text> : null}
        </View>
        <TouchableOpacity onPress={onPrev} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }} activeOpacity={0.6}>
          <IconPrev size={16} color={MX.color.iconIdle} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onTogglePlay} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }} activeOpacity={0.6}>
          {isPlay ? <IconPause size={18} color={MX.color.accent} /> : <IconPlay size={18} color={MX.color.accent} />}
        </TouchableOpacity>
        <TouchableOpacity onPress={onNext} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }} activeOpacity={0.6}>
          <IconNext size={16} color={MX.color.iconIdle} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  </View>
))
MxMiniBar.displayName = 'MxMiniBar'

/* ------------------------------- 抽屉菜单行 -------------------------------- */

export const MxNavRow = ({ icon, label, active, onPress }: {
  icon: ReactNode
  label: string
  active?: boolean
  onPress?: () => void
}) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.65} disabled={!onPress}>
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 12,
      paddingHorizontal: MX.space.page + 2,
      borderRadius: 8,
      marginHorizontal: 6,
      backgroundColor: active ? MX.color.accentDim : 'transparent',
    }}>
      <View style={{ width: 22, alignItems: 'center' }}>{icon}</View>
      <Text size={14} color={active ? MX.color.accent : MX.color.text2}>{label}</Text>
    </View>
  </TouchableOpacity>
)

/* -------------------------------- 分段选择 -------------------------------- */

export interface MxSegmentItem { key: string, label: string, disabled?: boolean }

/** 小胶囊分段（全部 / 本机 / NAS 这种） */
export const MxSegmented = ({ items, activeKey, onChange }: {
  items: MxSegmentItem[]
  activeKey: string
  onChange: (key: string) => void
}) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    {
      items.map(it => {
        const on = it.key == activeKey
        const off = !!it.disabled
        return (
          <TouchableOpacity key={it.key} onPress={() => { if (!off) onChange(it.key) }} activeOpacity={off ? 1 : 0.7}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: on && !off ? MX.color.accent : MX.color.line,
              backgroundColor: on && !off ? MX.color.accentDim : 'transparent',
              opacity: off ? 0.45 : 1,
            }}>
            <Text size={MX.font.caption} color={off ? MX.color.text4 : (on ? MX.color.accent : MX.color.text3)}>{it.label}</Text>
          </TouchableOpacity>
        )
      })
    }
  </View>
)

/* -------------------------------- 动作菜单 -------------------------------- */

export interface MxActionItem {
  key: string
  label: string
  danger?: boolean
  onPress: () => void
}

/** 底部动作菜单（行右侧「⋯」用） */
export const MxActionSheet = ({ visible, title, items, onClose }: {
  visible: boolean
  title?: string
  items: MxActionItem[]
  onClose: () => void
}) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
      <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{
        backgroundColor: MX.color.panel,
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
        paddingTop: 8,
        paddingBottom: 10,
        borderTopWidth: 1,
        borderTopColor: MX.color.line,
      }}>
        {title
          ? (
              <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
                <Text size={MX.font.row} color={MX.color.text2} numberOfLines={1}>{title}</Text>
              </View>
            )
          : null}
        {
          items.map(it => (
            <TouchableOpacity key={it.key} activeOpacity={0.65} onPress={() => { onClose(); it.onPress() }}>
              <View style={{ paddingHorizontal: 20, paddingVertical: 14 }}>
                <Text size={15} color={it.danger ? '#ff6b6b' : MX.color.text}>{it.label}</Text>
              </View>
            </TouchableOpacity>
          ))
        }
        <TouchableOpacity activeOpacity={0.65} onPress={onClose}>
          <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: MX.color.line, paddingVertical: 14, alignItems: 'center' }}>
            <Text size={14} color={MX.color.text3}>{global.i18n.t('cancel')}</Text>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </TouchableOpacity>
  </Modal>
)
