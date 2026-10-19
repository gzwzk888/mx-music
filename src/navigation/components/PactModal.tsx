import { useMemo, useState, useEffect } from 'react'
import { View, ScrollView, Image } from 'react-native'
import { Navigation } from 'react-native-navigation'

import Button from '@/components/common/Button'
import { createStyle, openUrl } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import ModalContent from './ModalContent'
import { exitApp } from '@/utils/nativeModules/utils'
import { updateSetting } from '@/core/common'
import { checkUpdate } from '@/core/version'
import { initDeeplink } from '@/core/init/deeplink'
import settingState from '@/store/setting/state'

const Content = () => {
  const theme = useTheme()

  const openHomePage = () => {
    void openUrl('https://github.com/lyswhut/lx-music-mobile#readme')
  }
  const openLicensePage = () => {
    void openUrl('http://www.apache.org/licenses/LICENSE-2.0')
  }

  const textLinkStyle = {
    ...styles.text,
    textDecorationLine: 'underline',
    color: theme['c-primary-font'],
    // fontSize: 15,
  } as const

  return (
    <View style={styles.main}>
      <Image source={require('@/resources/images/mx_logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title} size={18} >许可协议</Text>
      <ScrollView style={styles.content} keyboardShouldPersistTaps={'always'}>
        {!settingState.setting['common.isAgreePact'] && <Text selectable style={styles.bold} >在使用本软件前，你（使用者）需签署本协议才可继续使用！{'\n'}</Text>}
        <Text selectable style={styles.text} >1. 本软件为个人基于开源项目修改的软件，用于个人学习与技术研究，非商业用途，非官方发布。{'\n'}</Text>
        <Text selectable style={styles.text} >2. 本项目代码修改自 <Text onPress={openHomePage} style={textLinkStyle}>lyswhut/lx-music-mobile</Text>（<Text onPress={openLicensePage} style={textLinkStyle}>Apache License 2.0</Text> 许可），许可文本随安装包提供。{'\n'}</Text>
        <Text selectable style={styles.text} >3. 本软件不提供、不内置、不代理任何音乐内容或音源，仅用于播放使用者自行合法获取的本地文件与网络存储内容；所播放内容的合法性由使用者自行负责。{'\n'}</Text>
        <Text selectable style={styles.text} >4. 本软件按「现状」提供，不附带任何明示或默示担保；因使用本软件产生的任何直接或间接损失，作者不承担责任。{'\n'}</Text>
        <Text selectable style={styles.text} >5. 若你不同意上述条款，请勿使用本软件。</Text>
      </ScrollView>
    </View>
  )
}

const Footer = ({ componentId }: { componentId: string }) => {
  const theme = useTheme()
  const isAgreePact = useSettingValue('common.isAgreePact')
  // const checkUpdate = useDispatch('common', 'checkUpdate')
  const [time, setTime] = useState(20)

  const handleRejct = () => {
    exitApp()
    // Navigation.dismissOverlay(componentId)
  }

  const handleConfirm = () => {
    let _isAgreePact = isAgreePact
    if (!isAgreePact) updateSetting({ 'common.isAgreePact': true })
    void Navigation.dismissOverlay(componentId)
    if (!_isAgreePact) {
      setTimeout(() => {
        void initDeeplink()
      }, 2e3)
    }
  }


  const confirmBtn = useMemo(() => {
    if (isAgreePact) return { disabled: false, text: '关闭' }
    return time ? { disabled: true, text: `接受（${time}）` } : { disabled: false, text: '接受' }
  }, [isAgreePact, time])

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
      {
        isAgreePact
          ? null
          : (
              <Text selectable style={styles.tip} size={13}>若你（使用者）接受以上协议，请点击下面的“接受”按钮签署本协议；若不接受，请点击“不接受”后退出软件并清除本软件的所有数据。</Text>
            )
      }
      <View style={styles.btns}>
        {
          isAgreePact
            ? null
            : (
                <Button style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }} onPress={handleRejct}>
                  <Text color={theme['c-button-font']}>不接受</Text>
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
  logo: { width: 64, height: 64, alignSelf: 'center', marginBottom: 4, borderRadius: 14 },
  main: {
    // flexGrow: 0,
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
    // paddingRight: 15,
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

