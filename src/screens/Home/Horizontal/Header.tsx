import StatusBar from '@/components/common/StatusBar'
import { MX } from '@/theme/mx'
import { MxIconButton, MxTopBar } from '@/components/mx'
import { IconSearch } from '@/components/mx/Icons'
import { useNavActiveId } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { setNavActiveId } from '@/core/common'
import { NAV_MENUS } from '@/config/constant'

/**
 * 宽屏顶栏：侧栏常驻，所以没有菜单按钮；只保留标题与页面动作。
 * 「音乐库」页自带顶栏（含扫描动作），这里不再重复渲染。
 */
const Header = () => {
  const id = useNavActiveId()
  const t = useI18n()

  // 这些页自带顶栏（含页面内动作），外壳不再重复渲染
  if (id == 'nav_local' || id == 'nav_dirs' || id == 'nav_nas' || id == 'nav_setting' || id == 'nav_love') return <StatusBar />

  const menu = NAV_MENUS.find(m => m.id == id)
  const label = menu ? t(menu.labelKey) : String(id)

  return (
    <>
      <StatusBar />
      <MxTopBar
        title={label}
        actions={[{
          key: 'search',
          node: <MxIconButton onPress={() => { setNavActiveId('nav_search') }}><IconSearch size={18} color={MX.color.text} /></MxIconButton>,
        }]}
      />
    </>
  )
}

export default Header
