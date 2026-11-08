import { MX } from '@/theme/mx'
import {
  IconAlbum, IconFolder, IconHeart, IconNas, IconSearch, IconSetting, IconShuffle,
} from './Icons'

/** 导航项 → 自绘线性图标（Onkyo 风格） */
export const MxNavIcon = ({ id, active, size = 20 }: {
  id: string
  active?: boolean
  size?: number
}) => {
  const color = active ? MX.color.accent : MX.color.iconIdle
  switch (id) {
    case 'nav_local':
      return <IconAlbum size={size} color={color} />
    case 'nav_songlist':
      return <IconShuffle size={size} color={color} />
    case 'nav_love':
      return <IconHeart size={size} color={color} />
    case 'nav_nas':
      return <IconNas size={size} color={color} />
    case 'nav_dirs':
      return <IconFolder size={size} color={color} />
    case 'nav_search':
      return <IconSearch size={size} color={color} />
    case 'nav_setting':
      return <IconSetting size={size} color={color} />
    default:
      return <IconAlbum size={size} color={color} />
  }
}
