import { memo } from 'react'
import { View } from 'react-native'

import { useSettingValue } from '@/store/setting/hook'
import { createStyle } from '@/utils/tools'
import CheckBoxItem from '../../components/CheckBoxItem'
import { setDesktopLyricBold } from '@/core/desktopLyric'
import { updateSetting } from '@/core/common'

/** 桌面歌词加粗 */
export default memo(() => {
  const isBold = useSettingValue('desktopLyric.style.isBold')
  const update = (bold: boolean) => {
    void setDesktopLyricBold(bold).then(() => {
      updateSetting({ 'desktopLyric.style.isBold': bold })
    })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem check={isBold} onChange={update} label="歌词加粗" />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
