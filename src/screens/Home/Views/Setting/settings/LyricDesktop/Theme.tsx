import { updateSetting } from '@/core/common'
import { setDesktopLyricColor } from '@/core/desktopLyric'
import { useI18n } from '@/lang'
import { memo } from 'react'
import { StyleSheet, View, TouchableOpacity } from 'react-native'

import SubTitle from '../../components/SubTitle'
import { MX_ACCENTS } from '@/theme/mx'

// 只保留 5 色：蓝 / 黄 / 橙红（与主题强调色同值）+ 黑 / 白
const themes: Array<[string, string]> = [
  [MX_ACCENTS.blue.main, 'rgba(0,0,0,0.6)'],
  [MX_ACCENTS.yellow.main, 'rgba(0,0,0,0.6)'],
  [MX_ACCENTS.orange.main, 'rgba(0,0,0,0.6)'],
  [MX_ACCENTS.green.main, 'rgba(0,0,0,0.6)'],
  ['#000000', '#ffffff'],
  ['#ffffff', 'rgba(0,0,0,0.6)'],
]
type Theme = [string, string]

const ThemeItem = ({ color, change }: {
  color: Theme
  change: (color: Theme) => void
}) => {
  return (
    <TouchableOpacity style={styles.item} activeOpacity={0.5} onPress={() => { change(color) }}>
      <View style={styles.colorContent}>
        <View style={{ ...styles.image, backgroundColor: color[0] }}></View>
      </View>
    </TouchableOpacity>
  )
}

export default memo(() => {
  const t = useI18n()

  const setThemeDesktopLyric = (color: Theme) => {
    // const shadowColor = 'rgba(0,0,0,0.6)'
    void setDesktopLyricColor(null, color[0], color[1]).then(() => {
      updateSetting({ 'desktopLyric.style.lyricPlayedColor': color[0], 'desktopLyric.style.lyricShadowColor': color[1] })
    })
  }

  return (
    <SubTitle title={t('setting_lyric_desktop_theme')}>
      <View style={styles.list}>
        {
          themes.map((c, i) => <ThemeItem key={i.toString()} color={c} change={setThemeDesktopLyric} />)
        }
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  item: {
    marginRight: 15,
    marginTop: 5,
    alignItems: 'center',
    width: 26,
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  colorContent: {
    width: 26,
    height: 26,
    borderRadius: 4,
    // borderWidth: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: 20,
    height: 20,
    borderRadius: 4,
    elevation: 1,
  },
})
