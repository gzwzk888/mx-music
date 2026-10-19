import { memo, useMemo, useEffect, useRef, useCallback, useState } from 'react'
import { View, FlatList, TouchableOpacity, type FlatListProps, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native'
// import { useLayout } from '@/utils/hooks'
import { type Line, useLrcPlay, useLrcSet } from '@/plugins/lyric'
import { createStyle } from '@/utils/tools'
import { COMPONENT_IDS } from '@/config/constant'
// import { useComponentIds } from '@/store/common/hook'
import { Navigation } from 'react-native-navigation'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { AnimatedColorText } from '@/components/common/Text'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { usePlayerMusicInfo } from '@/store/player/hook'
import InfoModal from '../InfoModal'
import ArtistModal from '../ArtistModal'
import LyricSearchModal from '../LyricSearchModal'
import LyricOffsetModal from '../LyricOffsetModal'
import { formatLyricOffset, getLyricOffset } from '@/core/lyricOffset'
import { ArtistIcon } from '@/components/common/PlayIcons'
import { setSpText } from '@/utils/pixelRatio'
import playerState from '@/store/player/state'
import commonState from '@/store/common/state'
import { setNavActiveId } from '@/core/common'
import { scrollTo } from '@/utils/scroll'
import PlayLine, { type PlayLineType } from '../components/PlayLine'
// import { screenkeepAwake } from '@/utils/nativeModules/utils'
// import { log } from '@/utils/log'
// import { toast } from '@/utils/tools'

type FlatListType = FlatListProps<Line>

// const useLock = () => {
//   const showCommentRef = useRef(false)


//   useEffect(() => {
//     let appstateListener = AppState.addEventListener('change', (state) => {
//       switch (state) {
//         case 'active':
//           if (showLyricRef.current && !showCommentRef.current) screenkeepAwake()
//           break
//         case 'background':
//           screenUnkeepAwake()
//           break
//       }
//     })
//     return () => {
//       appstateListener.remove()
//     }
//   }, [])
//   useEffect(() => {
//     let listener: ReturnType<typeof onNavigationComponentDidDisappearEvent>
//     showCommentRef.current = !!componentIds.comment
//     if (showCommentRef.current) {
//       if (showLyricRef.current) screenUnkeepAwake()
//       listener = onNavigationComponentDidDisappearEvent(componentIds.comment as string, () => {
//         if (showLyricRef.current && AppState.currentState == 'active') screenkeepAwake()
//       })
//     }

//     const rm = global.state_event.on('componentIdsUpdated', (ids) => {

//     })

//     return () => {
//       if (listener) listener.remove()
//     }
//   }, [])
// }

interface LineProps {
  line: Line
  lineNum: number
  activeLine: number
  onLayout: (lineNum: number, height: number, width: number) => void
}
const LrcLine = memo(({ line, lineNum, activeLine, onLayout }: LineProps) => {
  const theme = useTheme()
  const lrcFontSize = useSettingValue('playDetail.vertical.style.lrcFontSize')
  const textAlign = useSettingValue('playDetail.style.align')
  const size = lrcFontSize / 10
  const lineHeight = setSpText(size) * 1.3

  const colors = useMemo(() => {
    const active = activeLine == lineNum
    return active ? [
      theme['c-primary'],
      theme['c-primary-alpha-200'],
      1,
    ] as const : [
      theme['c-350'],
      theme['c-300'],
      0.6,
    ] as const
  }, [activeLine, lineNum, theme])

  const handleLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    onLayout(lineNum, nativeEvent.layout.height, nativeEvent.layout.width)
  }


  // textBreakStrategy="simple" 用于解决某些设备上字体被截断的问题
  // https://stackoverflow.com/a/72822360
  return (
    <View style={styles.line} onLayout={handleLayout}>
      <AnimatedColorText style={{
        ...styles.lineText,
        textAlign,
        lineHeight,
      }} textBreakStrategy="simple" color={colors[0]} opacity={colors[2]} size={size}>{line.text}</AnimatedColorText>
      {
        line.extendedLyrics.map((lrc, index) => {
          return (<AnimatedColorText style={{
            ...styles.lineTranslationText,
            textAlign,
            lineHeight: lineHeight * 0.8,
          }} textBreakStrategy="simple" key={index} color={colors[1]} opacity={colors[2]} size={size * 0.8}>{lrc}</AnimatedColorText>)
        })
      }
    </View>
  )
}, (prevProps, nextProps) => {
  return prevProps.line === nextProps.line &&
    prevProps.activeLine != nextProps.lineNum &&
    nextProps.activeLine != nextProps.lineNum
})
const wait = async() => new Promise(resolve => setTimeout(resolve, 100))

export default () => {
  const theme = useTheme()
  const musicInfo = usePlayerMusicInfo()
  const [infoVisible, setInfoVisible] = useState(false)
  const [artistVisible, setArtistVisible] = useState(false)
  const [lyricSearchVisible, setLyricSearchVisible] = useState(false)
  const [offsetVisible, setOffsetVisible] = useState(false)
  const [offsetMs, setOffsetMs] = useState(0)
  const lyricLines = useLrcSet()
  const { line } = useLrcPlay()
  const flatListRef = useRef<FlatList>(null)
  const playLineRef = useRef<PlayLineType>(null)
  const isPauseScrollRef = useRef(true)
  const scrollTimoutRef = useRef<NodeJS.Timeout | null>(null)
  const delayScrollTimeout = useRef<NodeJS.Timeout | null>(null)
  const lineRef = useRef({ line: 0, prevLine: 0 })
  const isFirstSetLrc = useRef(true)
  const scrollInfoRef = useRef<NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'] | null>(null)
  const listLayoutInfoRef = useRef<{ spaceHeight: number, lineHeights: number[] }>({ spaceHeight: 0, lineHeights: [] })
  const scrollCancelRef = useRef<(() => void) | null>(null)
  const isShowLyricProgressSetting = useSettingValue('playDetail.isShowLyricProgressSetting')
  // useLock()
  // const [imgUrl, setImgUrl] = useState(null)
  // const theme = useGetter('common', 'theme')
  // const { onLayout, ...layout } = useLayout()

  // useEffect(() => {
  //   const url = playMusicInfo ? playMusicInfo.musicInfo.img : null
  //   if (imgUrl == url) return
  //   setImgUrl(url)
  // // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [playMusicInfo])

  // const imgWidth = useMemo(() => layout.width * 0.75, [layout.width])
  const handleScrollToActive = (index = lineRef.current.line) => {
    if (index < 0) return
    if (flatListRef.current) {
      // console.log('handleScrollToActive', index)
      if (scrollInfoRef.current && lineRef.current.line - lineRef.current.prevLine == 1) {
        let offset = listLayoutInfoRef.current.spaceHeight
        for (let line = 0; line < index; line++) {
          offset += listLayoutInfoRef.current.lineHeights[line]
        }
        offset += (listLayoutInfoRef.current.lineHeights[line] ?? 0) / 2
        try {
          scrollCancelRef.current = scrollTo(flatListRef.current, scrollInfoRef.current, offset - scrollInfoRef.current.layoutMeasurement.height * 0.42, 600, () => {
            scrollCancelRef.current = null
          })
        } catch {}
      } else {
        if (scrollCancelRef.current) {
          scrollCancelRef.current()
          scrollCancelRef.current = null
        }
        try {
          flatListRef.current.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0.42,
          })
        } catch {}
      }
    }
  }

  const handleScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollInfoRef.current = nativeEvent
    if (isPauseScrollRef.current) {
      playLineRef.current?.updateScrollInfo(nativeEvent)
    }
  }
  const handleScrollBeginDrag = () => {
    isPauseScrollRef.current = true
    playLineRef.current?.setVisible(true)
    if (delayScrollTimeout.current) {
      clearTimeout(delayScrollTimeout.current)
      delayScrollTimeout.current = null
    }
    if (scrollTimoutRef.current) {
      clearTimeout(scrollTimoutRef.current)
      scrollTimoutRef.current = null
    }
    if (scrollCancelRef.current) {
      scrollCancelRef.current()
      scrollCancelRef.current = null
    }
  }

  const onScrollEndDrag = () => {
    if (!isPauseScrollRef.current) return
    if (scrollTimoutRef.current) clearTimeout(scrollTimoutRef.current)
    scrollTimoutRef.current = setTimeout(() => {
      playLineRef.current?.setVisible(false)
      scrollTimoutRef.current = null
      isPauseScrollRef.current = false
      if (!playerState.isPlay) return
      handleScrollToActive()
    }, 3000)
  }


  useEffect(() => {
    return () => {
      if (delayScrollTimeout.current) {
        clearTimeout(delayScrollTimeout.current)
        delayScrollTimeout.current = null
      }
      if (scrollTimoutRef.current) {
        clearTimeout(scrollTimoutRef.current)
        scrollTimoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    // linesRef.current = lyricLines
    listLayoutInfoRef.current.lineHeights = []
    lineRef.current.prevLine = 0
    lineRef.current.line = 0
    if (!flatListRef.current) return
    flatListRef.current.scrollToOffset({
      offset: 0,
      animated: false,
    })
    if (!lyricLines.length) return
    playLineRef.current?.updateLyricLines(lyricLines)
    requestAnimationFrame(() => {
      if (isFirstSetLrc.current) {
        isFirstSetLrc.current = false
        setTimeout(() => {
          isPauseScrollRef.current = false
          handleScrollToActive()
        }, 100)
      } else {
        if (delayScrollTimeout.current) clearTimeout(delayScrollTimeout.current)
        delayScrollTimeout.current = setTimeout(() => {
          handleScrollToActive(0)
        }, 100)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricLines])

  useEffect(() => {
    if (line < 0) return
    lineRef.current.prevLine = lineRef.current.line
    lineRef.current.line = line
    if (!flatListRef.current || isPauseScrollRef.current) return

    if (line - lineRef.current.prevLine != 1) {
      handleScrollToActive()
      return
    }

    delayScrollTimeout.current = setTimeout(() => {
      delayScrollTimeout.current = null
      handleScrollToActive()
    }, 600)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line])

  useEffect(() => {
    requestAnimationFrame(() => {
      playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
      playLineRef.current?.updateLyricLines(lyricLines)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShowLyricProgressSetting])

  // 显示当前歌词同步偏移（打开弹窗 / 切歌时刷新）
  useEffect(() => {
    const id = (musicInfo as any)?.id as string | undefined
    setOffsetMs(id ? getLyricOffset(id) : 0)
  }, [musicInfo, offsetVisible])

  const handleScrollToIndexFailed: FlatListType['onScrollToIndexFailed'] = (info) => {
    void wait().then(() => {
      handleScrollToActive(info.index)
    })
  }

  const handleLineLayout = useCallback<LineProps['onLayout']>((lineNum, height) => {
    listLayoutInfoRef.current.lineHeights[lineNum] = height
    playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
  }, [])

  const handleSpaceLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    listLayoutInfoRef.current.spaceHeight = nativeEvent.layout.height
    playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
  }, [])

  // 右上角设置：直接切到「设置」页并关闭播放页
  const handleOpenSettings = useCallback(() => {
    setNavActiveId('nav_setting')
    const id = commonState.componentIds[COMPONENT_IDS.playDetail]
    if (id) setTimeout(() => { void Navigation.pop(id) }, 60)
  }, [])

  const handlePlayLine = useCallback((time: number) => {
    playLineRef.current?.setVisible(false)
    global.app_event.setProgress(time)
  }, [])

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => {
    return (
      <LrcLine line={item} lineNum={index} activeLine={line} onLayout={handleLineLayout} />
    )
  }
  const getkey: FlatListType['keyExtractor'] = (item, index) => `${index}${item.text}`

  const spaceComponent = useMemo(() => (
    <View style={styles.space} onLayout={handleSpaceLayout}></View>
  ), [handleSpaceLayout])

  return (
    <View style={styles.root}>
      <View style={{ ...styles.header, borderBottomColor: theme['c-border-background'] }}>
        <View style={styles.headerText}>
          <Text size={15} color={theme['c-font']} numberOfLines={1}>{musicInfo.name}</Text>
          <Text style={styles.headerSinger} size={12} color={theme['c-400']} numberOfLines={1}>{musicInfo.singer || '未知艺人'}</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.actionBtn, styles.offsetBtn]} onPress={() => { setOffsetVisible(true) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="music_time" size={21} color={offsetMs ? theme['c-primary'] : theme['c-400']} />
            {offsetMs
              ? <Text size={12} color={theme['c-primary']} style={styles.offsetText}>{formatLyricOffset(offsetMs)}</Text>
              : null}
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => { setLyricSearchVisible(true) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="lyric-on" size={20} color={theme['c-400']} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => { setArtistVisible(true) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ArtistIcon size={22} color={theme['c-400']} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => { setInfoVisible(true) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="help" size={21} color={theme['c-400']} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleOpenSettings} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="setting" size={20} color={theme['c-400']} />
          </TouchableOpacity>
        </View>
      </View>
      <FlatList
        data={lyricLines}
        renderItem={renderItem}
        keyExtractor={getkey}
        style={styles.container}
        ref={flatListRef}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={spaceComponent}
        ListFooterComponent={spaceComponent}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text size={13} color={theme['c-400']}>这首歌还没取到歌词</Text>
            <TouchableOpacity style={[styles.emptyBtn, { borderColor: theme['c-primary'] }]} onPress={() => { setLyricSearchVisible(true) }}>
              <Text size={13} color={theme['c-primary']}>手动搜索歌词</Text>
            </TouchableOpacity>
          </View>
        }
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        fadingEdgeLength={100}
        initialNumToRender={Math.max(line + 10, 10)}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onScroll={handleScroll}
      />
      { isShowLyricProgressSetting ? <PlayLine ref={playLineRef} onPlayLine={handlePlayLine} /> : null }
      <InfoModal visible={infoVisible} onClose={() => { setInfoVisible(false) }} />
      <ArtistModal visible={artistVisible} onClose={() => { setArtistVisible(false) }} />
      <LyricSearchModal visible={lyricSearchVisible} onClose={() => { setLyricSearchVisible(false) }} />
      <LyricOffsetModal
        visible={offsetVisible}
        onClose={() => { setOffsetVisible(false) }}
        onSearch={() => { setOffsetVisible(false); setLyricSearchVisible(true) }}
      />
    </View>
  )
}

const styles = createStyle({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
    marginBottom: 4,
    borderBottomWidth: 0.5,
  },
  headerText: {
    flex: 1,
    paddingRight: 10,
  },
  headerSinger: {
    marginTop: 2,
  },
  offsetBtn: {
    width: 'auto',
    minWidth: 32,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  offsetText: {
    marginLeft: 4,
  },
  infoBtn: {
    padding: 4,
  },
  infoBtnGap: {
    marginLeft: 16,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  container: {
    flex: 1,
    paddingLeft: 20,
    paddingRight: 20,
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
  space: {
    paddingTop: '100%',
  },
  line: {
    paddingTop: 10,
    paddingBottom: 10,
    // opacity: 0,
  },
  lineText: {
    textAlign: 'center',
    // fontSize: 16,
    // lineHeight: 20,
    // paddingTop: 5,
    // paddingBottom: 5,
    // opacity: 0,
  },
  lineTranslationText: {
    textAlign: 'center',
    // fontSize: 13,
    // lineHeight: 17,
    paddingTop: 5,
    // paddingBottom: 5,
  },
})
