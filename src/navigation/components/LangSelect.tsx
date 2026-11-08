import { memo } from 'react'
import { View, TouchableOpacity, Image, StatusBar, ScrollView, useWindowDimensions } from 'react-native'

import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { setLanguage, updateSetting } from '@/core/common'
import { dismissOverlay, showPactModal } from '@/navigation/utils'

type LangId = 'zh_cn' | 'zh_tw' | 'en_us'

const OPTIONS: { id: LangId, label: string, sub: string }[] = [
  { id: 'zh_cn', label: '简体中文', sub: 'Simplified Chinese' },
  { id: 'zh_tw', label: '繁體中文', sub: 'Traditional Chinese' },
  { id: 'en_us', label: 'English', sub: 'English' },
]

export default memo(({ componentId }: { componentId: string }) => {
  const { height } = useWindowDimensions()
  const compact = height < 620
  const logoSize = compact ? 52 : 76

  const handleSelect = (id: LangId) => {
    updateSetting({ 'common.isSelectedLang': true })
    setLanguage(id)
    void dismissOverlay(componentId)
    // 协议之后再弹防骗提示（避让遮罩退场动画）
    setTimeout(() => { showPactModal() }, 320)
  }

  return (
    <View style={{ flex: 1, backgroundColor: MX.color.app }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingTop: compact ? 26 : 56,
          paddingBottom: 26,
          paddingHorizontal: compact ? 80 : 28,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', marginBottom: compact ? 14 : 40 }}>
          <Image
            source={require('@/resources/images/mx_logo.png')}
            style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 4.2 }}
            resizeMode="contain"
          />
          <Text size={compact ? 18 : 20} color={MX.color.text} style={{ marginTop: compact ? 10 : 16, letterSpacing: 0.5 }}>MX Music</Text>
          <Text size={13} color={MX.color.text3} style={{ marginTop: 6, letterSpacing: 0.3 }}>墨玄音乐 · 墨玄音樂</Text>
          <Text size={13} color={MX.color.text3} style={{ marginTop: compact ? 14 : 22 }}>选择语言 / 選擇語言 / Select language</Text>
        </View>

        {OPTIONS.map((opt, i) => (
          <TouchableOpacity
            key={opt.id}
            activeOpacity={0.7}
            onPress={() => { handleSelect(opt.id) }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: compact ? 12 : 16,
              paddingHorizontal: 20,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: MX.color.line,
              backgroundColor: MX.color.card,
              marginBottom: i === OPTIONS.length - 1 ? 0 : 12,
            }}
          >
            <Text size={16} color={MX.color.text}>{opt.label}</Text>
            <Text size={12} color={MX.color.text4}>{opt.sub}</Text>
          </TouchableOpacity>
        ))}

        <Text size={11} color={MX.color.text4} style={{ textAlign: 'center', marginTop: compact ? 12 : 28, lineHeight: 17 }}>
          之后可在「设置 → 语言」中更改{'｜'}之後可在「設定 → 語言」中更改{'｜'}Settings → Language
        </Text>
      </ScrollView>
    </View>
  )
})
