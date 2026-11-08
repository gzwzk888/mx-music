import { useMemo, useState, useEffect } from 'react'
import { View, Image, ScrollView, useWindowDimensions } from 'react-native'
import { Navigation } from 'react-native-navigation'

import Button from '@/components/common/Button'
import { createStyle } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import ModalContent from './ModalContent'
import { exitApp } from '@/utils/nativeModules/utils'
import { updateSetting } from '@/core/common'
import { initDeeplink } from '@/core/init/deeplink'
import settingState from '@/store/setting/state'
import { useI18n } from '@/lang'
import { saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'

const Content = () => {
  const t = useI18n()
  const { height } = useWindowDimensions()

  return (
    <View style={styles.main}>
      <Image source={require('@/resources/images/mx_logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title} size={18}>{t('pact_title')}</Text>
      <ScrollView
        style={[styles.content, { height: Math.max(190, height * 0.37), flexShrink: 0 }]}
        keyboardShouldPersistTaps={'always'}
      >
        {!settingState.setting['common.isAgreePact'] && <Text selectable style={styles.bold} >{t('pact_notice')}{'\n'}</Text>}
        <Text selectable style={styles.text} >{t('pact_p1')}{'\n'}</Text>
        <Text selectable style={styles.text} >{t('pact_p2')}{'\n'}</Text>
        <Text selectable style={styles.text} >{t('pact_p3')}{'\n'}</Text>
        <Text selectable style={styles.text} >{t('pact_p4')}</Text>
      </ScrollView>
    </View>
  )
}

const Footer = ({ componentId }: { componentId: string }) => {
  const theme = useTheme()
  const t = useI18n()
  const isAgreePact = useSettingValue('common.isAgreePact')
  const [time, setTime] = useState(10)

  const handleRejct = () => {
    // 拒绝协议：清掉「已选语言」标记，下次启动回到语言选择
    updateSetting({ 'common.isSelectedLang': false })
    void saveData(storageDataPrefix.setting, settingState.setting).then(() => {
      exitApp()
    })
  }

  const handleConfirm = () => {
    let _isAgreePact = isAgreePact
    if (!isAgreePact) updateSetting({ 'common.isAgreePact': true })
    void Navigation.dismissOverlay(componentId)
    if (!_isAgreePact) {
      setTimeout(() => {
        void initDeeplink()
      }, 800)
    }
  }

  const confirmBtn = useMemo(() => {
    if (isAgreePact) return { disabled: false, text: t('pact_close') }
    return time ? { disabled: true, text: `${t('pact_accept')} (${time})` } : { disabled: false, text: t('pact_accept') }
  }, [isAgreePact, time, t])

  useEffect(() => {
    if (isAgreePact) return
    const timeoutTools = {
      timeout: null as NodeJS.Timeout | null,
      start() {
        this.timeout = setTimeout(() => {
          setTime(time => {
            time--
            if (time > 0) this.start()
            return time
          })
        }, 1000)
      },
      clear() {
        if (!this.timeout) return
        clearTimeout(this.timeout)
      },
    }
    timeoutTools.start()
    return () => {
      timeoutTools.clear()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <View style={styles.btns}>
        {
          isAgreePact
            ? null
            : (
                <Button style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }} onPress={handleRejct}>
                  <Text color={theme['c-button-font']}>{t('pact_reject')}</Text>
                </Button>
              )
        }
        <Button disabled={confirmBtn.disabled} style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }} onPress={handleConfirm}>
          <Text color={theme['c-button-font']}>{confirmBtn.text}</Text>
        </Button>
      </View>
    </>
  )
}

const PactModal = ({ componentId }: { componentId: string }) => {
  return (
    <ModalContent>
      <Content />
      <Footer componentId={componentId} />
    </ModalContent>
  )
}

const styles = createStyle({
  logo: { width: 52, height: 52, alignSelf: 'center', marginBottom: 2, borderRadius: 12 },
  main: {
    flexShrink: 1,
    marginTop: 15,
    marginBottom: 10,
  },
  content: {
    flexGrow: 0,
    marginLeft: 5,
    marginRight: 5,
    paddingLeft: 10,
    paddingRight: 10,
  },
  title: {
    textAlign: 'center',
    marginBottom: 15,
  },
  part: {
    marginBottom: 10,
  },
  text: {
    fontSize: 14,
    textAlignVertical: 'bottom',
    marginBottom: 5,
  },
  bold: {
    fontSize: 14,
    textAlignVertical: 'bottom',
    fontWeight: 'bold',
  },
  tip: {
    textAlignVertical: 'bottom',
    fontWeight: 'bold',
    paddingLeft: 15,
    paddingRight: 15,
    paddingBottom: 15,
  },
  btns: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 15,
    paddingLeft: 15,
  },
  btn: {
    flex: 1,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 10,
    paddingRight: 10,
    alignItems: 'center',
    borderRadius: 4,
    marginRight: 15,
  },
})

export default PactModal
