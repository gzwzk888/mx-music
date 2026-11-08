import { initSetting, showPactModal } from '@/core/common'
import { showLangSelectModal } from '@/navigation'
import { SKIP_FIRST_RUN_DIALOGS } from '@/config/constant'
import registerPlaybackService from '@/plugins/player/service'
import initTheme from './theme'
import initI18n from './i18n'
import initUserApi from './userApi'
import initPlayer from './player'
import dataInit from './dataInit'
import initSync from './sync'
import initCommonState from './common'
import { initDeeplink } from './deeplink'
import { setApiSource } from '@/core/apiSource'
import commonActions from '@/store/common/action'
import settingState from '@/store/setting/state'
import { checkUpdate } from '@/core/version'
import { bootLog } from '@/utils/bootLog'
import { initPlayStats } from '@/core/nas/playStats'
import { autoScanOnce } from '@/core/local/dirs'

let isFirstPush = true
const handlePushedHomeScreen = async() => {
  // 首次启动：语言选择最先（选完后由 LangSelect 串起 防骗提示 -> 协议）
  if (!SKIP_FIRST_RUN_DIALOGS && !settingState.setting['common.isSelectedLang']) {
    if (isFirstPush) isFirstPush = false
    showLangSelectModal()
    return
  }
  if (SKIP_FIRST_RUN_DIALOGS) {
    if (isFirstPush) {
      isFirstPush = false
      void initDeeplink()
    }
    return
  }
  if (settingState.setting['common.isAgreePact']) {
    if (isFirstPush) {
      isFirstPush = false
      // void checkUpdate()  // 个人版不检查更新
      void initDeeplink()
    }
  } else {
    if (isFirstPush) isFirstPush = false
    showPactModal()
  }
}

let isInited = false
export default async() => {
  if (isInited) return handlePushedHomeScreen
  bootLog('Initing...')
  void initPlayStats()
  // App 启动就重扫一次已添加的音乐目录（不阻塞首屏，后台跑）
  setTimeout(() => { void autoScanOnce() }, 1500)
  commonActions.setFontSize(global.lx.fontSize)
  bootLog('Font size changed.')
  const setting = await initSetting()
  bootLog('Setting inited.')
  // console.log(setting)

  await initTheme(setting)
  bootLog('Theme inited.')
  await initI18n(setting)
  bootLog('I18n inited.')

  await initUserApi(setting)
  bootLog('User Api inited.')

  setApiSource(setting['common.apiSource'])
  bootLog('Api inited.')

  registerPlaybackService()
  bootLog('Playback Service Registered.')
  await initPlayer(setting)
  bootLog('Player inited.')
  await dataInit(setting)
  bootLog('Data inited.')
  await initCommonState(setting)
  bootLog('Common State inited.')

  void initSync(setting)
  bootLog('Sync inited.')

  // syncSetting()

  isInited ||= true

  return handlePushedHomeScreen
}
