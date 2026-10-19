import { memo } from 'react'
import { View, TouchableOpacity, Image } from 'react-native'

import Section from '../components/Section'

import { createStyle, openUrl } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { MX_BUILD } from '@/config/constant'

const REPO_URL = 'https://github.com/lyswhut/lx-music-mobile'
const LICENSE_URL = 'https://github.com/lyswhut/lx-music-mobile/blob/master/LICENSE'

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()

  const openRepo = () => { void openUrl(REPO_URL) }
  const openLicense = () => { void openUrl(LICENSE_URL) }

  const linkStyle = {
    ...styles.text,
    textDecorationLine: 'underline',
    color: theme['c-primary-font'],
  } as const

  return (
    <Section title={t('setting_about')}>
      <View style={styles.logoWrap}>
        <Image source={require('@/resources/images/mx_logo.png')} style={styles.logo} resizeMode="contain" />
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>
          MX Music（墨玄音乐）· 个人修改版 v1.0（{MX_BUILD.replace(/^b/, '')}）· 构建 {MX_BUILD}
        </Text>
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>
          基于开源播放器 LX Music 修改，用于个人学习与技术研究，非商业用途，非官方发布。
        </Text>
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>本项目修改自 lyswhut/lx-music-mobile（Apache-2.0 许可）。原项目地址：</Text>
        <TouchableOpacity onPress={openRepo}>
          <Text style={linkStyle}>{REPO_URL}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>许可证全文：</Text>
        <TouchableOpacity onPress={openLicense}>
          <Text style={linkStyle}>Apache License 2.0</Text>
        </TouchableOpacity>
        <Text style={styles.text}>（许可文本亦随安装包提供）</Text>
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>
          本软件不提供、不内置、不代理任何音乐内容或音源，仅用于播放用户自行合法获取的本地文件与网络存储内容。用户应自行确保所播放内容的合法性。
        </Text>
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>
          本软件按「现状」提供，不附带任何明示或默示担保。因使用本软件产生的任何直接或间接损失，作者不承担责任。本软件为个人项目，不提供客户服务。
        </Text>
      </View>

      <View style={styles.signWrap}>
        <Text style={styles.text}>By：無戈</Text>
        <Image
          source={require('@/resources/images/seal_yin.png')}
          style={styles.seal}
          resizeMode="contain"
        />
      </View>
    </Section>
  )
})

const styles = createStyle({
  logoWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  logo: { width: 72, height: 72, borderRadius: 16 },
  part: {
    marginLeft: 15,
    marginRight: 15,
    marginBottom: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  text: {
    fontSize: 14,
    lineHeight: 21,
    textAlignVertical: 'bottom',
  },
  signWrap: {
    marginLeft: 15,
    marginRight: 15,
    marginTop: 4,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  seal: {
    width: 38,
    height: 38,
    marginLeft: 12,
    transform: [{ rotate: '-4deg' }],
  },
  boldText: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlignVertical: 'bottom',
  },
})
