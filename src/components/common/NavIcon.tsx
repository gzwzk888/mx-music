import { memo } from 'react'
import Svg, { Path, Circle } from 'react-native-svg'
import { Icon } from './Icon'

const W = 2

/** 音乐服务器：云 + 音符 */
const CloudMusicIcon = ({ size, color }: { size: number, color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M5.6 12.4h6.9a3 3 0 0 0 .25-5.97 4.35 4.35 0 0 0-8.3-.95A2.85 2.85 0 0 0 5.6 12.4z"
      fill="none" stroke={color} strokeWidth={W} strokeLinejoin="round" strokeLinecap="round"
    />
    <Circle cx={15.7} cy={18.05} r={2} fill="none" stroke={color} strokeWidth={W} />
    <Path d={`M17.4 18.1V9.9`} fill="none" stroke={color} strokeWidth={W} strokeLinecap="round" />
    <Path d="M17.7 9.9c1.7.4 2.6 1.35 2.75 2.9" fill="none" stroke={color} strokeWidth={W} strokeLinecap="round" />
  </Svg>
)

/** 本机音乐：文件夹 + 音符 */
const FolderMusicIcon = ({ size, color }: { size: number, color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M3.9 7.4h2.5a1.5 1.5 0 0 1 1.06.44l1.2 1.2h3.84a1.6 1.6 0 0 1 1.6 1.6v6.36a1.6 1.6 0 0 1-1.6 1.6H4a1.6 1.6 0 0 1-1.6-1.6V9a1.6 1.6 0 0 1 1.5-1.6z"
      fill="none" stroke={color} strokeWidth={W} strokeLinejoin="round" strokeLinecap="round"
    />
    <Circle cx={17.7} cy={17.75} r={1.95} fill="none" stroke={color} strokeWidth={W} />
    <Path d="M19.65 17.75V7" fill="none" stroke={color} strokeWidth={W} strokeLinecap="round" />
    <Path d="M19.65 7c1.75.4 2.65 1.4 2.8 3" fill="none" stroke={color} strokeWidth={W} strokeLinecap="round" />
  </Svg>
)

/**
 * 导航图标：nav_nas / nav_local 用自绘 SVG（字体里没有这两个图形），其余沿用字体图标
 */
export const NavIcon = memo(({ id, icon, size = 20, color }: {
  id: string
  icon: string
  size?: number
  color: string
}) => {
  if (id == 'nav_nas') return <CloudMusicIcon size={size} color={color} />
  if (id == 'nav_local') return <FolderMusicIcon size={size} color={color} />
  return <Icon name={icon} size={size} color={color} />
})
