/**
 * MX 自绘线性图标集（SVG，1.6px 描边 / 圆头 / 单色）
 * 全部按 Onkyo 那种「细线 + 无填充 + 单色」语言重画，不引用任何第三方 App 素材。
 */
import { memo } from 'react'
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg'
import { MX } from '@/theme/mx'

export interface MxIconProps {
  size?: number
  color?: string
  strokeWidth?: number
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
})

const mk = (draw: (p: Required<MxIconProps>) => JSX.Element) => memo((props: MxIconProps) => {
  const p = {
    size: props.size ?? MX.size.icon,
    color: props.color ?? MX.color.iconIdle,
    strokeWidth: props.strokeWidth ?? 1.6,
  }
  return (
    <Svg {...base(p.size)} fill="none" stroke={p.color} strokeWidth={p.strokeWidth}
      strokeLinecap="round" strokeLinejoin="round">
      {draw(p)}
    </Svg>
  )
})
mk.displayName = 'MxIcon'

export const IconMenu = mk(() => (
  <>
    <Line x1="3.5" y1="6.5" x2="20.5" y2="6.5" />
    <Line x1="3.5" y1="12" x2="20.5" y2="12" />
    <Line x1="3.5" y1="17.5" x2="20.5" y2="17.5" />
  </>
))

export const IconSearch = mk(() => (
  <>
    <Circle cx="11" cy="11" r="6.6" />
    <Line x1="16" y1="16" x2="20.6" y2="20.6" />
  </>
))

export const IconRefresh = mk(() => (
  <>
    <Path d="M20.4 12a8.4 8.4 0 1 1-2.6-6.1" />
    <Path d="M20.4 4.2v5h-5" />
  </>
))

export const IconMore = memo((props: MxIconProps) => {
  const size = props.size ?? MX.size.icon
  const color = props.color ?? MX.color.iconIdle
  return (
    <Svg {...base(size)} fill={color}>
      <Circle cx="12" cy="5.2" r="1.55" />
      <Circle cx="12" cy="12" r="1.55" />
      <Circle cx="12" cy="18.8" r="1.55" />
    </Svg>
  )
})
IconMore.displayName = 'IconMore'

export const IconBack = mk(() => <Path d="M15 4.5 7.5 12 15 19.5" />)

/** 返回：回转箭头（粗线 U 形回头 + 左侧箭头），用于播放页横屏工具条 */
export const IconReturnWide = mk(() => (
  <>
    <Path d="M5.4 9h8.9a4.3 4.3 0 0 1 0 8.6H9" />
    <Path d="M9.2 5.2 5.4 9l3.8 3.8" />
  </>
))

export const IconChevronDown = mk(() => <Path d="M5 9.5 12 16.5 19 9.5" />)
export const IconChevronRight = mk(() => <Path d="M9.5 5 16.5 12 9.5 19" />)
/* ---------------- 播放页主控（横向拉宽的扁平款，只给播放页用） ---------------- */

/** 播放：空心宽三角 */
export const IconPlayWide = mk((p) => (
  <Path d="M6 6.4 21 12 6 17.6z" fill="none" strokeWidth={p.strokeWidth} />
))

/** 暂停：两根竖条（与宽三角同高） */
export const IconPauseWide = mk(() => (
  <>
    <Path d="M8.4 6.4v11.2" />
    <Path d="M15.6 6.4v11.2" />
  </>
))

/** 上一首：宽三角 + 竖条 */
export const IconPrevWide = mk(() => (
  <>
    <Path d="M19.8 6.4 7.2 12l12.6 5.6z" />
    <Path d="M4.6 6.4v11.2" />
  </>
))

/** 下一首 */
export const IconNextWide = mk(() => (
  <>
    <Path d="M4.2 6.4 16.8 12 4.2 17.6z" />
    <Path d="M19.4 6.4v11.2" />
  </>
))

/** 列表循环：双横线 + 左右箭头（行距 7 格，墨迹高仍 11.6） */
export const IconRepeatWide = mk(() => (
  <>
    <Path d="M4.2 8.5h13.2" />
    <Path d="M15.2 6.2 18.2 8.5 15.2 10.8" />
    <Path d="M19.8 15.5H6.6" />
    <Path d="M8.8 13.2 5.8 15.5 8.8 17.8" />
  </>
))

/** 单曲循环：双横线 + 中间一个 1 */
export const IconRepeatOneWide = mk(() => (
  <>
    <Path d="M4.2 8h13.2" />
    <Path d="M15.2 5.4 18.2 8 15.2 10.6" />
    <Path d="M19.8 16H6.6" />
    <Path d="M8.8 13.4 5.8 16 8.8 18.6" />
    <Path d="M11.4 11.2 12.8 10.4v3.2" />
  </>
))

/** 顺序播放：三条横线 + 向下箭头 */
export const IconOrderWide = mk(() => (
  <>
    <Path d="M4.2 7.4h11" />
    <Path d="M4.2 12h11" />
    <Path d="M4.2 16.6h7" />
    <Path d="M18 6.6v10.8" />
    <Path d="M15.4 14.6 18 17.4 20.6 14.6" />
  </>
))

/** 随机：交叉箭头（几何已按墨迹高归一 15.2 → 11.6 格，与循环/音量同高；描边仍 1.6） */
export const IconShuffleWide = mk(() => (
  <>
    <Path d="M5.59 8.34 8.03 8.34 15.82 15.66 18.41 15.66" />
    <Path d="M15.97 13.53 18.41 15.66 15.97 17.8" />
    <Path d="M5.59 15.66 8.03 15.66 10.47 13.37" />
    <Path d="M13.14 8.34 15.82 10.86 18.41 10.86" />
    <Path d="M15.97 6.2 18.41 8.34 15.97 10.47" />
  </>
))

/** 定时（时钟） */
export const IconClock = mk(() => (
  <>
    <Circle cx="12" cy="12" r="7.6" />
    <Path d="M12 7.8v4.6l3 1.8" />
  </>
))

/** 喇叭（音量） */
export const IconVolumeWide = mk(() => (
  <>
    <Path d="M4.6 9.6h3l4.2-3.4v11.6l-4.2-3.4h-3z" />
    <Path d="M15.2 9.4a3.9 3.9 0 0 1 0 5.2" />
    <Path d="M17.8 7a7.2 7.2 0 0 1 0 10" />
  </>
))

/** 房屋（返回桌面）：带烟囱 + 门的单笔轮廓，和用户给的样式一致 */
export const IconHome = mk(() => (
  <Path d="M3.1 11.2 L12 3.8 L14.55 6.15 V4.3 H17.5 V8.95 L20.9 11.2 V20.2 H14.2 V13.5 H9.8 V20.2 H3.1 Z" />
))

export const IconPlay = memo((props: MxIconProps) => {
  const size = props.size ?? MX.size.icon
  const color = props.color ?? MX.color.text
  return (
    <Svg {...base(size)} fill={color}>
      <Path d="M8 4.8v14.4L19.2 12 z" />
    </Svg>
  )
})
IconPlay.displayName = 'IconPlay'

export const IconPause = mk((p) => (
  <>
    <Line x1="9" y1="5" x2="9" y2="19" strokeWidth={p.strokeWidth + 0.6} />
    <Line x1="15" y1="5" x2="15" y2="19" strokeWidth={p.strokeWidth + 0.6} />
  </>
))

export const IconPrev = mk((p) => (
  <>
    <Path d="M18.5 5.5v13L9 12 z" fill={p.color} stroke="none" />
    <Line x1="6" y1="5" x2="6" y2="19" strokeWidth={p.strokeWidth + 0.4} />
  </>
))

export const IconNext = mk((p) => (
  <>
    <Path d="M5.5 5.5v13L15 12 z" fill={p.color} stroke="none" />
    <Line x1="18" y1="5" x2="18" y2="19" strokeWidth={p.strokeWidth + 0.4} />
  </>
))

export const IconShuffle = mk(() => (
  <>
    <Path d="M3.5 7h4l3 4 3.5 5h5" />
    <Path d="M16 4l3.5 3-3.5 3" />
    <Path d="M3.5 17h4l2.2-3" />
    <Path d="M16 14l3.5 3-3.5 3" />
  </>
))

export const IconRepeat = mk(() => (
  <>
    <Path d="M6.5 6.5h11a2.5 2.5 0 0 1 2.5 2.5v2" />
    <Path d="M17 4l2.6 2.8L17 9.2" />
    <Path d="M17.5 17.5h-11A2.5 2.5 0 0 1 4 15v-2" />
    <Path d="M7 20l-2.6-2.8L7 14.8" />
  </>
))

export const IconRepeatOne = mk(() => (
  <>
    <Path d="M6.5 6.5h11a2.5 2.5 0 0 1 2.5 2.5v2" />
    <Path d="M17 4l2.6 2.8L17 9.2" />
    <Path d="M17.5 17.5h-11A2.5 2.5 0 0 1 4 15v-2" />
    <Path d="M7 20l-2.6-2.8L7 14.8" />
    <Line x1="12" y1="10" x2="12" y2="14.4" strokeWidth={1.4} />
  </>
))

/** 均衡器：波形折线（Onkyo 的 EQ 图标语义，形状自绘） */
export const IconEq = mk(() => (
  <>
    <Path d="M3 15.5h3.4l2-7.5 2.6 11 2.4-6 1.8 2.5H21" />
  </>
))

/**
 * 均衡器字标「EQ」：真矢量轮廓（Segoe UI Semibold 字形，横向按墨迹居中、大写高 11.6 格 = 与其它图标同墨迹高）
 * 用文字版（<Text>）会因基线算法 + 尾字距而右偏 1.1dp、下偏 2.8dp，且各端字体不同；
 * 用轮廓路径则浏览器 / 设计软件 / Android 摆位一致。
 */
export const IconEqLetter = memo((props: MxIconProps) => {
  const size = props.size ?? MX.size.icon
  const color = props.color ?? MX.color.iconIdle
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7.915 17.8H1.403V6.2H7.656V7.834H3.328V11.118H7.316V12.744H3.328V16.174H7.915Z M15.81 17.994Q14.556 17.994 13.537 17.565Q12.518 17.137 11.798 16.364Q11.078 15.592 10.681 14.516Q10.285 13.44 10.285 12.138Q10.285 10.746 10.685 9.614Q11.086 8.481 11.826 7.68Q12.566 6.879 13.626 6.443Q14.686 6.006 15.996 6.006Q17.209 6.006 18.213 6.435Q19.216 6.863 19.927 7.636Q20.639 8.408 21.032 9.484Q21.424 10.56 21.424 11.854Q21.424 13.569 20.85 14.86Q20.275 16.15 19.232 16.934L22.597 19.361H19.669L17.598 17.751Q17.185 17.865 16.74 17.929Q16.295 17.994 15.81 17.994ZM15.899 7.697Q15.106 7.697 14.447 8.008Q13.788 8.319 13.31 8.89Q12.833 9.46 12.57 10.253Q12.307 11.045 12.307 12.016Q12.307 12.979 12.562 13.772Q12.817 14.564 13.278 15.126Q13.739 15.689 14.386 16Q15.033 16.312 15.818 16.312Q16.651 16.312 17.315 16.02Q17.978 15.729 18.443 15.183Q18.908 14.637 19.159 13.844Q19.41 13.052 19.41 12.04Q19.41 11.005 19.167 10.196Q18.924 9.387 18.471 8.833Q18.018 8.279 17.367 7.988Q16.716 7.697 15.899 7.697Z" fill={color} />
    </Svg>
  )
})
IconEqLetter.displayName = 'MxIconEqLetter'

export const IconLyrics = mk(() => (
  <>
    <Line x1="4" y1="7" x2="20" y2="7" />
    <Line x1="4" y1="12" x2="14.5" y2="12" />
    <Line x1="4" y1="17" x2="17.5" y2="17" />
  </>
))

export const IconInfo = mk(() => (
  <>
    <Circle cx="12" cy="12" r="8.2" />
    <Line x1="12" y1="10.6" x2="12" y2="16.4" />
    <Circle cx="12" cy="7.9" r="0.9" fill="currentColor" stroke="none" />
  </>
))

export const IconCast = mk(() => (
  <>
    <Path d="M12 4.5v11" />
    <Path d="M8.2 8.3 12 4.5l3.8 3.8" />
    <Path d="M5 15.5v3.2h14v-3.2" />
  </>
))

export const IconAlbum = mk(() => (
  <>
    <Circle cx="12" cy="12" r="8.4" />
    <Circle cx="12" cy="12" r="2.1" />
  </>
))

export const IconArtist = mk(() => (
  <>
    <Circle cx="12" cy="9" r="3.2" />
    <Path d="M5.5 19.5c.9-3.4 3.4-5.2 6.5-5.2s5.6 1.8 6.5 5.2" />
  </>
))

export const IconFolder = mk(() => (
  <>
    <Path d="M3.5 7.2h6l1.6 2.2h9.4v9.1H3.5z" />
    <Path d="M3.5 7.2V5.6h6l1.6 1.6" />
  </>
))

export const IconList = mk(() => (
  <>
    <Line x1="8" y1="7" x2="20.5" y2="7" />
    <Line x1="8" y1="12" x2="20.5" y2="12" />
    <Line x1="8" y1="17" x2="20.5" y2="17" />
    <Circle cx="4.4" cy="7" r="1" fill="currentColor" stroke="none" />
    <Circle cx="4.4" cy="12" r="1" fill="currentColor" stroke="none" />
    <Circle cx="4.4" cy="17" r="1" fill="currentColor" stroke="none" />
  </>
))

export const IconHeart = mk((p) => (
  <Path d="M12 19.6S4 14.9 4 9.9A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 8 1.9c0 5-8 9.7-8 9.7z"
    fill={p.color === MX.color.iconIdle ? 'none' : p.color} />
))

export const IconNas = mk(() => (
  <>
    <Rect x="3.5" y="4.6" width="17" height="6.2" rx="1.6" />
    <Rect x="3.5" y="13.2" width="17" height="6.2" rx="1.6" />
    <Circle cx="7" cy="7.7" r="0.95" fill="currentColor" stroke="none" />
    <Circle cx="7" cy="16.3" r="0.95" fill="currentColor" stroke="none" />
  </>
))

/** 齿轮：8 齿，齿顶平、齿根平（自己算的路径，不是贴图） */
const gearPath = (() => {
  const cx = 12
  const cy = 12
  const rTip = 9.4
  const rRoot = 7.1
  const teeth = 8
  const step = (Math.PI * 2) / teeth
  const tipHalf = step * 0.20
  const rootHalf = step * 0.31
  const pt = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`
  const pts: string[] = []
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2
    pts.push(pt(rRoot, a - rootHalf))
    pts.push(pt(rTip, a - tipHalf))
    pts.push(pt(rTip, a + tipHalf))
    pts.push(pt(rRoot, a + rootHalf))
  }
  return 'M' + pts.join(' L') + ' Z'
})()

export const IconSetting = mk(() => (
  <>
    <Path d={gearPath} />
    <Circle cx="12" cy="12" r="3.1" />
  </>
))

export const IconPlus = mk(() => (
  <>
    <Line x1="12" y1="5" x2="12" y2="19" />
    <Line x1="5" y1="12" x2="19" y2="12" />
  </>
))

export const IconClose = mk(() => (
  <>
    <Line x1="6" y1="6" x2="18" y2="18" />
    <Line x1="18" y1="6" x2="6" y2="18" />
  </>
))

export const IconCheck = mk(() => <Path d="M5 12.5 9.8 17.4 19 6.8" />)

export const IconSort = mk(() => (
  <>
    <Line x1="3.5" y1="7" x2="13" y2="7" />
    <Line x1="3.5" y1="12" x2="10.5" y2="12" />
    <Line x1="3.5" y1="17" x2="8" y2="17" />
    <Path d="M17.5 5v14M15 16l2.5 3 2.5-3" />
  </>
))

export const IconScan = mk(() => (
  <>
    <Path d="M4 9V5.5h3.5M20 9V5.5h-3.5M4 15v3.5h3.5M20 15v3.5h-3.5" />
    <Line x1="4" y1="12" x2="20" y2="12" />
  </>
))

export const IconVolume = mk(() => (
  <>
    <Path d="M4 10v4h2.8L11 17.4V6.6L6.8 10H4z" />
    <Path d="M14.6 9.4a3.8 3.8 0 0 1 0 5.2" />
  </>
))

/** 封面缺图时用的占位：黑胶盘 */
export const IconDisc = mk(() => (
  <>
    <Circle cx="12" cy="12" r="8.6" />
    <Circle cx="12" cy="12" r="2.2" />
  </>
))
