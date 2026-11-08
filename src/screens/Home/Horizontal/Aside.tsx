import { memo } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import Text from '@/components/common/Text'
import Image from '@/components/common/Image'
import { MxNavRow, MxSectionLabel } from '@/components/mx'
import { MxNavIcon } from '@/components/mx/NavIcon'
import { IconClose, IconHome } from '@/components/mx/Icons'
import { MX } from '@/theme/mx'
import { useAccentTick } from '@/theme/useAccentTick'
import { MX_BUILD, NAV_GROUP_LABEL, NAV_MENUS } from '@/config/constant'
import type { InitState } from '@/store/common/state'
import { useWindowSize } from '@/utils/hooks'
import { exitApp, setNavActiveId } from '@/core/common'
import { confirmDialog, exitApp as backHome } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'

const MX_LOGO = require('@/resources/images/mx_logo.png')

/** 窄侧栏宽度（只有图标） */
const RAIL_WIDTH = 68
/** 宽侧栏宽度（图标 + 文字，平板用） */
const WIDE_WIDTH = 196

type IdType = InitState['navActiveId'] | 'nav_exit' | 'back_home'

/** 宽屏左侧导航：Onkyo 那种「图标栏 / 图标+文字栏」两态 */
export default memo(() => {
  const t = useI18n()
  const statusBarHeight = useStatusbarHeight()
  const activeId = useNavActiveId()
  const { width } = useWindowSize()
  const showText = width >= 700
  const navWidth = showText ? WIDE_WIDTH : RAIL_WIDTH
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

  const RailItem = ({ id, onPress, node }: { id: IdType, onPress?: () => void, node?: React.ReactNode }) => {
    const on = activeId == id
    return (
      <TouchableOpacity onPress={onPress} disabled={!onPress} activeOpacity={0.65} style={{ alignItems: 'center', paddingVertical: 14 }}>
        <View style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: on ? MX.color.circleOn : 'transparent',
        }}>
          {node ?? <MxNavIcon id={id} active={on} size={21} />}
        </View>
      </TouchableOpacity>
    )
  }

  const groups: Array<'music' | 'tool'> = ['music', 'tool']

  return (
    <View style={{
      width: navWidth,
      backgroundColor: MX.color.app,
      borderRightWidth: 1,
      borderRightColor: MX.color.line,
      paddingTop: statusBarHeight,
    }}>
      <View style={{
        flexDirection: showText ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: showText ? 10 : 6,
        paddingTop: 16,
        paddingBottom: 14,
        paddingHorizontal: 12,
      }}>
        <Image url={MX_LOGO} style={{ width: showText ? 26 : 28, height: showText ? 26 : 28, borderRadius: 7 }} />
        {showText ? <Text size={15} color={MX.color.text} style={{ letterSpacing: 0.8 }}>墨玄音乐</Text> : null}
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {
          groups.map(g => {
            const menus = NAV_MENUS.filter(m => m.group == g)
            if (!menus.length) return null
            return (
              <View key={g}>
                {showText
                  ? <MxSectionLabel text={t(g == 'music' ? 'nav_group_music' : 'nav_group_tool')} />
                  : <View style={{ height: 1, backgroundColor: MX.color.line, marginHorizontal: 18, marginTop: 14 }} />}
                {
                  menus.map(menu => {
                    const on = activeId == menu.id
                    return showText
                      ? (
                          <MxNavRow
                            key={menu.id}
                            label={t(menu.labelKey)}
                            active={on}
                            icon={<MxNavIcon id={menu.id} active={on} />}
                            onPress={() => { handlePress(menu.id) }}
                          />
                        )
                      : <RailItem key={menu.id} id={menu.id} onPress={() => { handlePress(menu.id) }} />
                  })
                }
              </View>
            )
          })
        }
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderTopColor: MX.color.line, paddingVertical: 6 }}>
        {showBackBtn
          ? showText
            ? <MxNavRow label={global.i18n.t('back_home')} icon={<IconHome size={18} color={MX.color.iconIdle} />} onPress={() => { handlePress('back_home') }} />
            : <RailItem id="back_home" node={<IconHome size={20} color={MX.color.iconIdle} />} onPress={() => { handlePress('back_home') }} />
          : null}
        {showExitBtn
          ? showText
            ? <MxNavRow label={global.i18n.t('nav_exit')} icon={<IconClose size={18} color={MX.color.iconIdle} />} onPress={() => { handlePress('nav_exit') }} />
            : <RailItem id="nav_exit" node={<IconClose size={20} color={MX.color.iconIdle} />} onPress={() => { handlePress('nav_exit') }} />
          : null}
        {showText
          ? <Text size={MX.font.caption} color={MX.color.text4} style={{ paddingHorizontal: 20, paddingTop: 6 }}>{t('app_build')} {MX_BUILD}</Text>
          : null}
      </View>
    </View>
  )
})
