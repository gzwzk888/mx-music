import { memo, useEffect, useMemo, useRef } from 'react'
import { View, TouchableOpacity, FlatList, type NativeScrollEvent, type NativeSyntheticEvent, type FlatListProps } from 'react-native'

import { Icon } from '@/components/common/Icon'

import { useTheme } from '@/store/theme/hook'
import { useActiveListId, useListFetching, useMyList } from '@/store/list/hook'
import { createStyle } from '@/utils/tools'
import { LIST_SCROLL_POSITION_KEY, LIST_IDS } from '@/config/constant'
import { getListPosition, saveListPosition } from '@/utils/data'
import { setActiveList } from '@/core/list'
import Text from '@/components/common/Text'
import { type Position } from './ListMenu'
import { scaleSizeH } from '@/utils/pixelRatio'
import Loading from '@/components/common/Loading'

type FlatListType = FlatListProps<LX.List.MyListInfo>

const ITEM_HEIGHT = scaleSizeH(40)
const HEADER_HEIGHT = scaleSizeH(30)

const NAS_LIST_PREFIX = 'NAS·'          // 旧命名（兼容）
const NAS_ID_PREFIX = 'userlist_nas_'

const ListItem = memo(({ item, index, activeId, onPress, onShowMenu }: {
  onPress: (item: LX.List.MyListInfo) => void
  index: number
  activeId: string
  item: LX.List.MyListInfo
  onShowMenu: (item: LX.List.MyListInfo, index: number, position: { x: number, y: number, w: number, h: number }) => void
}) => {
  const theme = useTheme()
  const moreButtonRef = useRef<TouchableOpacity>(null)
  const fetching = useListFetching(item.id)

  const active = activeId == item.id

  const handleShowMenu = () => {
    if (moreButtonRef.current?.measure) {
      moreButtonRef.current.measure((fx, fy, width, height, px, py) => {
        // console.log(fx, fy, width, height, px, py)
        onShowMenu(item, index, { x: Math.ceil(px), y: Math.ceil(py), w: Math.ceil(width), h: Math.ceil(height) })
      })
    }
  }

  const handlePress = () => {
    onPress(item)
  }

  return (
    <View style={{ ...styles.listItem, height: ITEM_HEIGHT }}>
      {
        active
          ? <Icon style={styles.listActiveIcon} name="chevron-right" size={12} color={theme['c-primary-font']} />
          : null
      }
      { fetching ? <Loading color={active ? theme['c-primary-font'] : theme['c-font']} style={styles.loading} /> : null }
      <TouchableOpacity style={styles.listName} onPress={handlePress}>
        <Text numberOfLines={1} color={active ? theme['c-primary-font'] : theme['c-font']}>{item.name}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.listMoreBtn}>
        <Icon name="dots-vertical" color={theme['c-350']} size={12} />
      </TouchableOpacity>
    </View>
  )
}, (prevProps, nextProps) => {
  return !!(prevProps.item === nextProps.item &&
    prevProps.index === nextProps.index &&
    prevProps.item.name == nextProps.item.name &&
    prevProps.activeId != nextProps.item.id &&
    nextProps.activeId != nextProps.item.id
  )
})


export default ({ onShowMenu }: {
  onShowMenu: (info: { listInfo: LX.List.MyListInfo, index: number }, position: Position) => void
}) => {
  const flatListRef = useRef<FlatList>(null)
  const theme = useTheme()
  const allList = useMyList()
  const activeListId = useActiveListId()

  const handleToggleList = (item: LX.List.MyListInfo) => {
    // setVisiblePanel(false)
    global.app_event.changeLoveListVisible(false)
    requestAnimationFrame(() => {
      setActiveList(item.id)
    })
  }


  const handleScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    void saveListPosition(LIST_SCROLL_POSITION_KEY, nativeEvent.contentOffset.y)
  }

  const showMenu = (listInfo: LX.List.MyListInfo, index: number, position: Position) => {
    onShowMenu({ listInfo, index }, position)
  }

  useEffect(() => {
    void getListPosition(LIST_SCROLL_POSITION_KEY).then((offset) => {
      flatListRef.current?.scrollToOffset({ offset, animated: false })
    })
  }, [])

  // 分成三段：试听列表 / 我的收藏 / NAS 列表（其余自建列表归入「其他列表」）
  type Row =
    | { type: 'header', id: string, title: string }
    | { type: 'item', id: string, item: LX.List.MyListInfo, index: number }

  const rows = useMemo<Row[]>(() => {
    const temp = allList.find(l => l.id == LIST_IDS.DEFAULT)
    const love = allList.find(l => l.id == LIST_IDS.LOVE)
    const rest = allList.filter(l => l.id != LIST_IDS.DEFAULT && l.id != LIST_IDS.LOVE)
    const isNasList = (l: LX.List.MyListInfo) => l.id.startsWith(NAS_ID_PREFIX) || l.name.startsWith(NAS_LIST_PREFIX)
    const nas = rest.filter(isNasList)
    const other = rest.filter(l => !isNasList(l))

    const out: Row[] = []
    const pushSection = (title: string, lists: Array<LX.List.MyListInfo | undefined>) => {
      const valid = lists.filter((l): l is LX.List.MyListInfo => !!l)
      if (!valid.length) return
      out.push({ type: 'header', id: `h_${title}`, title })
      valid.forEach(l => {
        out.push({ type: 'item', id: l.id, item: l, index: allList.indexOf(l) })
      })
    }
    pushSection('试听列表', [temp])
    pushSection('我的收藏', [love])
    pushSection('NAS 列表', nas)
    pushSection('其他列表', other)
    return out
  }, [allList])

  const renderRow: FlatListProps<Row>['renderItem'] = ({ item }) => {
    if (item.type == 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Text size={11} color={theme['c-350']}>{item.title}</Text>
        </View>
      )
    }
    return (
      <ListItem
        item={item.item}
        index={item.index}
        activeId={activeListId}
        onPress={handleToggleList}
        onShowMenu={showMenu}
      />
    )
  }
  const getkey: FlatListProps<Row>['keyExtractor'] = (item) => item.id
  const getItemLayout: FlatListProps<Row>['getItemLayout'] = (data, index) => {
    const rowsData = Array.from(data ?? [])
    let offset = 0
    for (let i = 0; i < index; i++) {
      offset += rowsData[i]?.type == 'header' ? HEADER_HEIGHT : ITEM_HEIGHT
    }
    return { length: rowsData[index]?.type == 'header' ? HEADER_HEIGHT : ITEM_HEIGHT, offset, index }
  }

  return (
    <FlatList
      ref={flatListRef}
      onScroll={handleScroll}
      style={styles.container}
      data={rows}
      maxToRenderPerBatch={9}
      windowSize={9}
      removeClippedSubviews={true}
      initialNumToRender={18}
      renderItem={renderRow}
      keyExtractor={getkey}
      getItemLayout={getItemLayout}
    />
  )
}


const styles = createStyle({
  sectionHeader: {
    height: HEADER_HEIGHT,
    justifyContent: 'flex-end',
    paddingLeft: 8,
    paddingBottom: 2,
    opacity: 0.9,
  },
  container: {
    flexShrink: 1,
    flexGrow: 0,
  },
  // listContainer: {
  //   // borderBottomWidth: BorderWidths.normal2,
  // },

  listItem: {
    height: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 5,
    paddingLeft: 5,
    // borderBottomWidth: BorderWidths.normal,
  },
  listActiveIcon: {
    // width: 18,
    marginLeft: 3,
    // paddingRight: 5,
    textAlign: 'center',
  },
  loading: {
    marginLeft: 5,
  },
  listName: {
    height: '100%',
    // height: 46,
    // paddingTop: 12,
    // paddingBottom: 12,
    justifyContent: 'center',
    flexGrow: 1,
    flexShrink: 1,
    paddingLeft: 5,
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
  // listNameText: {
  //   // height: 46,
  //   fontSize: 14,
  // },
  listMoreBtn: {
    height: '100%',
    width: 36,
    // height: 46,
    // paddingTop: 12,
    // paddingBottom: 12,
    justifyContent: 'center',
    alignItems: 'center',
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
})

