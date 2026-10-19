import { memo } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import { NavIcon } from '@/components/common/NavIcon'
import Text from '@/components/common/Text'
import Image from '@/components/common/Image'

const MX_LOGO = require('@/resources/images/mx_logo.png')
import { useWindowSize } from '@/utils/hooks'
import { confirmDialog, createStyle, exitApp as backHome } from '@/utils/tools'
import { NAV_MENUS } from '@/config/constant'
import type { InitState } from '@/store/common/state'
// import commonState from '@/store/common/state'
import { exitApp, setNavActiveId } from '@/core/common'
import { BorderWidths } from '@/theme'
import { useSettingValue } from '@/store/setting/hook'

const NAV_WIDTH = 68

const styles = createStyle({
  logo: { width: 32, height: 32, borderRadius: 8 },
  container: {
    flexGrow: 0,
    // flex: 1,
    // alignItems: 'center',
    // justifyContent: 'center',
    // padding: 10,
    borderRightWidth: BorderWidths.normal,
    paddingBottom: 10,
    width: NAV_WIDTH,
  },
  header: {
    paddingTop: 15,
    paddingBottom: 15,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    textAlign: 'center',
    marginLeft: 16,
  },
  menus: {
    flex: 1,
  },
  list: {
    // paddingTop: 10,
    paddingBottom: 15,
  },
  menuItem: {
    flexDirection: 'row',
    paddingTop: 15,
    paddingBottom: 15,
    // paddingLeft: 25,
    // paddingRight: 25,
    justifyContent: 'center',
    alignItems: 'center',
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  menuItemWide: {
    justifyContent: 'flex-start',
    paddingLeft: 18,
  },
  iconContent: {
    // width: 24,
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
    alignItems: 'center',
  },
  text: {
    paddingLeft: 15,
    // fontWeight: '500',
  },
})

const Header = () => {
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()
  return (
    <View style={{ paddingTop: statusBarHeight }}>
      <View style={styles.header}>
        <Image url={MX_LOGO} style={styles.logo} />
        {/* <Text style={styles.headerText} size={16} color={theme['c-primary-dark-100-alpha-300']}>LX Music</Text> */}
      </View>
    </View>
  )
}

type IdType = InitState['navActiveId'] | 'nav_exit' | 'back_home'

const MenuItem = ({ id, icon, onPress, showText }: {
  id: IdType
  icon: string
  onPress: (id: IdType) => void
  showText: boolean
}) => {
  // const t = useI18n()
  const activeId = useNavActiveId()
  const theme = useTheme()
  const label = global.i18n.t(id)

  return activeId == id
    ? <View style={{ ...styles.menuItem, ...(showText ? styles.menuItemWide : null) }}>
        <View style={styles.iconContent}>
          <NavIcon id={id} icon={icon} size={id == 'nav_nas' || id == 'nav_local' ? 24 : 20} color={theme['c-primary-font-active']} />
        </View>
        {showText ? <Text style={styles.text} size={14} color={theme['c-primary-font']}>{label}</Text> : null}
      </View>
    : <TouchableOpacity style={{ ...styles.menuItem, ...(showText ? styles.menuItemWide : null) }} onPress={() => { onPress(id) }}>
        <View style={styles.iconContent}>
          <NavIcon id={id} icon={icon} size={id == 'nav_nas' || id == 'nav_local' ? 24 : 20} color={theme['c-font-label']} />
        </View>
        {showText ? <Text style={styles.text} size={14}>{label}</Text> : null}
      </TouchableOpacity>
}

export default memo(() => {
  const theme = useTheme()
  const { width } = useWindowSize()
  // 平板/宽屏：侧栏显示文字
  const showText = width >= 700
  const navWidth = showText ? 190 : NAV_WIDTH
  // console.log('render drawer nav')
  const showBackBtn = useSettingValue('common.showBackBtn')
  const showExitBtn = useSettingValue('common.showExitBtn')

  const handlePress = (id: IdType) => {
    switch (id) {
      case 'nav_exit':
        void confirmDialog({
          message: global.i18n.t('exit_app_tip'),
          confirmButtonText: global.i18n.t('list_remove_tip_button'),
        }).then(isExit => {
          if (!isExit) return
          exitApp('Exit Btn')
        })
        return
      case 'back_home':
        backHome()
        return
    }

    global.app_event.changeMenuVisible(false)
    setNavActiveId(id)
  }

  return (
    <View style={{ ...styles.container, width: navWidth, borderRightColor: theme['c-border-background'] }}>
      <Header />
      <ScrollView style={styles.menus}>
        <View style={styles.list}>
          {NAV_MENUS.map(menu => <MenuItem key={menu.id} id={menu.id} icon={menu.icon} onPress={handlePress} showText={showText} />)}
        </View>
      </ScrollView>
      {
        showBackBtn ? <MenuItem id="back_home" icon="home" onPress={handlePress} showText={showText} /> : null
      }
      {
        showExitBtn ? <MenuItem id="nav_exit" icon="exit2" onPress={handlePress} showText={showText} /> : null
      }
    </View>
  )
})

