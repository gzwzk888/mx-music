import { memo } from 'react'
import Svg, { Path, Circle } from 'react-native-svg'

const W = 1.8

/** 艺人（人像轮廓）：用于「艺人简介」入口 */
export const ArtistIcon = memo(({ size = 18, color }: { size?: number, color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx={12} cy={8.4} r={3.7} fill="none" stroke={color} strokeWidth={W} />
    <Path
      d="M4.6 19.6c0-3.7 3.3-6.3 7.4-6.3s7.4 2.6 7.4 6.3"
      fill="none" stroke={color} strokeWidth={W} strokeLinecap="round"
    />
  </Svg>
))

/** 放大镜（矢量，避免字体图标被裁） */
export const SearchIcon = memo(({ size = 18, color }: { size?: number, color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx={10.5} cy={10.5} r={6.5} fill="none" stroke={color} strokeWidth={2} />
    <Path d="M15.4 15.4L21 21" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
))
