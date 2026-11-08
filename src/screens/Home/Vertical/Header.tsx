import { useNavActiveId } from '@/store/common/hook'
import { useI18n } from '@/lang'
import StatusBar from '@/components/common/StatusBar'
import { MX } from '@/theme/mx'
import { MxIconButton, MxTopBar } from '@/components/mx'
import { IconMenu, IconSearch } from '@/components/mx/Icons'
import { setNavActiveId } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { NAV_MENUS } from '@/config/constant'

/**
 * 顶栏（Onkyo 风格）：左圆底按钮 + 标题 + 右侧动作
 * 「音乐库」页自带顶栏（含扫描动作），这里不再重复渲染。
 */
const Header = () => {
  const id = useNavActiveId()
  const t = useI18n()
  const drawerLayoutPosition = useSettingValue('common.drawerLayoutPosition')

  // 这些页自带顶栏（含页面内动作），外壳不再重复渲染
  if (id == 'nav_local' || id == 'nav_dirs' || id == 'nav_nas' || id == 'nav_setting' || id == 'nav_love') return <StatusBar />

  const menu = NAV_MENUS.find(m => m.id == id)
  const label = menu ? t(menu.labelKey) : String(id)
  const menuOnRight = drawerLayoutPosition != 'left'
  const openMenu = () => { global.app_event.changeMenuVisible(true) }

  const menuBtn = {
    key: 'menu',
    node: <MxIconButton onPress={openMenu}><IconMenu size={20} color={MX.color.text} /></MxIconButton>,
  }
  const searchBtn = {
    key: 'search',
    node: <MxIconButton onPress={() => { setNavActiveId('nav_search') }}><IconSearch size={18} color={MX.color.text} /></MxIconButton>,
  }

  return (
    <>
      <StatusBar />
      <MxTopBar
        title={label}
        left={menuOnRight ? 'none' : 'menu'}
        onLeftPress={openMenu}
        actions={menuOnRight ? [searchBtn, menuBtn] : [searchBtn]}
      />
    </>
  )
}

export default Header
