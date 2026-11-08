import { useState } from 'react'

import { View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import Slider, { type SliderProps } from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import styles from './style'

/**
 * 歌词行距（垂直/横屏共用）
 * 100 = 原来的间距；平板屏幕大、看起来挤时调到 120~160
 */
const LrcLineSpace = () => {
  const theme = useTheme()
  const settingKey = 'playDetail.style.lrcLineSpace'
  const lineSpace = useSettingValue(settingKey)
  const [sliderSize, setSliderSize] = useState(lineSpace)
  const [isSliding, setSliding] = useState(false)
  const t = useI18n()

  const handleSlidingStart: SliderProps['onSlidingStart'] = () => {
    setSliding(true)
  }
  const handleValueChange: SliderProps['onValueChange'] = value => {
    setSliderSize(value)
  }
  const handleSlidingComplete: SliderProps['onSlidingComplete'] = value => {
    setSliding(false)
    if (lineSpace == value) return
    updateSetting({ [settingKey]: value })
  }

  return (
    <View style={styles.container}>
      <Text>{t('play_detail_setting_lrc_line_space')}</Text>
      <View style={styles.content}>
        <Text style={styles.label} color={theme['c-font-label']}>{isSliding ? sliderSize : lineSpace}%</Text>
        <Slider
          minimumValue={70}
          maximumValue={220}
          onSlidingComplete={handleSlidingComplete}
          onValueChange={handleValueChange}
          onSlidingStart={handleSlidingStart}
          step={5}
          value={lineSpace}
        />
      </View>
    </View>
  )
}

export default LrcLineSpace
