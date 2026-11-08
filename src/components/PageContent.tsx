import { View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import ImageBackground from '@/components/common/ImageBackground'
import { useWindowSize } from '@/utils/hooks'
import { useMemo } from 'react'
import { scaleSizeAbsHR } from '@/utils/pixelRatio'
import { defaultHeaders } from './common/Image'
import SizeView from './SizeView'
import { useBgPic } from '@/store/common/hook'
import { useSettingValue } from '@/store/setting/hook'
import { MX } from '@/theme/mx'

interface Props {
  children: React.ReactNode
}

const BLUR_RADIUS = Math.max(scaleSizeAbsHR(18), 10)

export default ({ children }: Props) => {
  const theme = useTheme()
  const windowSize = useWindowSize()
  const pic = useBgPic()
  const customBg = useSettingValue('theme.customBg')
  const customBgOpacity = useSettingValue('theme.customBgOpacity')

  /** ① 用户自选背景图（可调不透明度）：图片按设置的不透明度叠在纯黑底上，页面本身透明 */
  const customBgComponent = useMemo(() => {
    const opacity = Math.min(Math.max(customBgOpacity ?? 0.45, 0.05), 1)
    return (
      <View style={{ flex: 1, overflow: 'hidden', backgroundColor: MX.color.page }}>
        <ImageBackground
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: windowSize.height,
            width: windowSize.width,
            opacity,
          }}
          source={{ uri: customBg ?? undefined, headers: defaultHeaders }}
          resizeMode="cover"
        />
        {/* 顶部一层极淡的暗罩，保证白字在亮图上也可读 */}
        <View style={{ flex: 1, flexDirection: 'column', backgroundColor: 'rgba(6,6,6,0.18)' }}>
          {children}
        </View>
      </View>
    )
  }, [children, customBg, customBgOpacity, windowSize.height, windowSize.width])

  const themeComponent = useMemo(() => (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <ImageBackground
        style={{ position: 'absolute', left: 0, top: 0, height: windowSize.height, width: windowSize.width, backgroundColor: theme['c-content-background'] }}
        source={theme['bg-image']}
        resizeMode="cover"
      >
      </ImageBackground>
      <View style={{ flex: 1, flexDirection: 'column', backgroundColor: theme['c-main-background'] }}>
        {children}
      </View>
    </View>
  ), [children, theme, windowSize.height, windowSize.width])
  const picComponent = useMemo(() => {
    return (
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <ImageBackground
          style={{ position: 'absolute', left: 0, top: 0, height: windowSize.height, width: windowSize.width, backgroundColor: theme['c-content-background'] }}
          source={{ uri: pic!, headers: defaultHeaders }}
          resizeMode="cover"
          blurRadius={BLUR_RADIUS}
        >
          <View style={{ flex: 1, flexDirection: 'column', backgroundColor: theme['c-content-background'], opacity: 0.76 }}></View>
        </ImageBackground>
        <View style={{ flex: 1, flexDirection: 'column' }}>
          {children}
        </View>
      </View>
    )
  }, [children, pic, theme, windowSize.height, windowSize.width])

  return (
    <>
      <SizeView />
      {/* 已关掉「用歌曲封面做背景」：没设背景图时保持纯黑，避免封面上屏形成不明暗纹 */}
      {customBg ? customBgComponent : themeComponent}
    </>
  )
}
