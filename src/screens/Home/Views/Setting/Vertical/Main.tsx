import { memo, useCallback, useState } from 'react'
import { FlatList, ScrollView, TouchableOpacity, View, type FlatListProps } from 'react-native'

import Basic from '../settings/Basic'
import Player from '../settings/Player'
import LyricDesktop from '../settings/LyricDesktop'
import Search from '../settings/Search'
import List from '../settings/List'
import Other from '../settings/Other'
import About from '../settings/About'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import { BorderRadius, BorderWidths } from '@/theme'
import { SETTING_SCREENS, type SettingScreenIds } from '../Main'

type FlatListType = FlatListProps<SettingScreenIds>

const styles = createStyle({
  content: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 15,
    paddingBottom: 15,
    flex: 0,
  },
  menuContent: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 10,
    paddingBottom: 15,
  },
  menuItem: {
    height: 52,
    paddingLeft: 15,
    paddingRight: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: BorderRadius.normal,
  },
  menuItemBorder: {
    borderBottomWidth: BorderWidths.normal,
  },
  menuLabel: {
    flex: 1,
    paddingRight: 10,
  },
  backBar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 15,
    paddingRight: 15,
    borderBottomWidth: BorderWidths.normal,
  },
  backArrow: {
    width: 22,
    marginRight: 4,
  },
  detail: {
    flex: 1,
  },
})

const GroupView = memo(({ id }: { id: SettingScreenIds }) => {
  switch (id) {
    case 'player': return <Player />
    case 'lyric_desktop': return <LyricDesktop />
    case 'search': return <Search />
    case 'list': return <List />
    case 'other': return <Other />
    case 'about': return <About />
    case 'basic':
    default: return <Basic />
  }
}, () => true)

const MenuItem = memo(({ id, showBorder, onPress }: {
  id: SettingScreenIds
  showBorder: boolean
  onPress: (id: SettingScreenIds) => void
}) => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <TouchableOpacity
      style={{ ...styles.menuItem, ...(showBorder ? { ...styles.menuItemBorder, borderBottomColor: theme['c-border-background'] } : null) }}
      onPress={() => { onPress(id) }}
      activeOpacity={0.7}
    >
      <Text size={16} numberOfLines={1} style={styles.menuLabel}>{t(`setting_${id}`)}</Text>
      <Text size={18} color={theme['c-350']}>›</Text>
    </TouchableOpacity>
  )
}, (prev, next) => prev.id === next.id && prev.showBorder === next.showBorder)

export default () => {
  const [activeId, setActiveId] = useState<SettingScreenIds | null>(null)
  const theme = useTheme()
  const t = useI18n()

  const handleOpen = useCallback((id: SettingScreenIds) => {
    setActiveId(id)
  }, [])

  const handleBack = useCallback(() => {
    setActiveId(null)
    return true
  }, [])

  useBackHandler(useCallback(() => {
    if (activeId == null) return false
    setActiveId(null)
    return true
  }, [activeId]))

  if (activeId != null) {
    return (
      <View style={styles.detail}>
        <TouchableOpacity style={{ ...styles.backBar, borderBottomColor: theme['c-border-background'] }} onPress={handleBack} activeOpacity={0.7}>
          <Text size={20} color={theme['c-350']} style={styles.backArrow}>‹</Text>
          <Text size={15} numberOfLines={1}>{t(`setting_${activeId}`)}</Text>
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps={'always'}>
          <GroupView id={activeId} />
        </ScrollView>
      </View>
    )
  }

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => <MenuItem id={item} showBorder={index < SETTING_SCREENS.length - 1} onPress={handleOpen} />
  const getkey: FlatListType['keyExtractor'] = item => item

  return (
    <FlatList
      data={SETTING_SCREENS}
      keyboardShouldPersistTaps={'always'}
      renderItem={renderItem}
      keyExtractor={getkey}
      contentContainerStyle={styles.menuContent}
    />
  )
}
