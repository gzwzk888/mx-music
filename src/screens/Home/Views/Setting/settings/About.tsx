import { memo } from 'react'
import { View, Image } from 'react-native'

import Section from '../components/Section'

import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { MX_BUILD } from '@/config/constant'

export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_about')}>
      <View style={styles.logoWrap}>
        <Image source={require('@/resources/images/mx_logo.png')} style={styles.logo} resizeMode="contain" />
      </View>

      <View style={styles.part}>
        <Text style={styles.boldText}>{t('about_name')}</Text>
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>{t('about_build')} {MX_BUILD}</Text>
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>{t('about_desc')}</Text>
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>{t('about_third')}</Text>
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>{t('about_content')}</Text>
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>{t('about_disclaimer')}</Text>
      </View>

      <View style={styles.part}>
        <Text style={styles.text}>{t('about_noservice')}</Text>
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
    fontSize: 15,
    fontWeight: 'bold',
    textAlignVertical: 'bottom',
  },
})
