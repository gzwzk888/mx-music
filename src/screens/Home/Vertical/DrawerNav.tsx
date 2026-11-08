import { memo } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import Text from '@/components/common/Text'
import Image from '@/components/common/Image'
import { MxNavRow, MxSectionLabel } from '@/components/mx'
import { MxNavIcon } from '@/components/mx/NavIcon'
import { IconClose, IconHome } from '@/components/mx/Icons'
import { MX } from '@/theme/mx'
import { MX_BUILD, NAV_GROUP_LABEL, NAV_MENUS } from '@/config/constant'
import type { InitState } from '@/store/common/state'
import { exitApp, setNavActiveId } from '@/core/common'
import { confirmDialog, exitApp as backHome } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'

const MX_LOGO = require('@/resources/images/mx_logo.png')

type IdType = InitState['navActiveId'] | 'nav_exit' | 'back_home'

/** 抽屉菜单（Onkyo 风格：分组标题 + 图标行 + 底部构建号） */
export default memo(() => {
  const t = useI18n()
  const statusBarHeight = useStatusbarHeight()
  const activeId = useNavActiveId()
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

  const groups: Array<'music' | 'tool'> = ['music', 'tool']

  return (
    <View style={{ flex: 1, backgroundColor: MX.color.app, paddingTop: statusBarHeight }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18 }}>
        <Image url={MX_LOGO} style={{ width: 30, height: 30, borderRadius: 7 }} />
        <Text size={17} color={MX.color.text} style={{ letterSpacing: 1 }}>墨玄音乐</Text>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {
          groups.map(g => {
            const menus = NAV_MENUS.filter(m => m.group == g)
            if (!menus.length) return null
            return (
              <View key={g}>
                <MxSectionLabel text={t(g == 'music' ? 'nav_group_music' : 'nav_group_tool')} />
                {
                  menus.map(menu => {
                    const on = activeId == menu.id
                    return (
                      <MxNavRow
                        key={menu.id}
                        label={t(menu.labelKey)}
                        active={on}
                        icon={<MxNavIcon id={menu.id} active={on} size={20} />}
                        onPress={() => { handlePress(menu.id) }}
                      />
                    )
                  })
                }
              </View>
            )
          })
        }
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderTopColor: MX.color.line, paddingVertical: 6 }}>
        {showBackBtn ? <MxNavRow label={global.i18n.t('back_home')} icon={<IconHome size={18} color={MX.color.iconIdle} />} onPress={() => { handlePress('back_home') }} /> : null}
        {showExitBtn ? <MxNavRow label={global.i18n.t('nav_exit')} icon={<IconClose size={18} color={MX.color.iconIdle} />} onPress={() => { handlePress('nav_exit') }} /> : null}
        <TouchableOpacity activeOpacity={1} onPress={() => { global.app_event.changeMenuVisible(false) }} style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 }}>
          <Text size={MX.font.caption} color={MX.color.text4}>{t('app_build')} {MX_BUILD}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
})
