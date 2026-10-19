import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, ScrollView, TextInput, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useWindowSize } from '@/utils/hooks'
import { usePlayMusicInfo } from '@/store/player/hook'
import { createStyle } from '@/utils/tools'
import { saveLyric } from '@/utils/data'
import { play as playLyric, setLyric } from '@/plugins/lyric'
import { getPosition } from '@/plugins/player'
import playerState from '@/store/player/state'
import { fetchLyricForCandidate, searchLyricCandidates, type LyricCandidate } from '@/core/nas/lyricSearch'
import { resetLyricOffset } from '@/core/lyricOffset'

/**
 * 手动搜歌词（歌在源里没搜到时兜底）
 */
export default ({ visible, onClose }: { visible: boolean, onClose: () => void }) => {
  const theme = useTheme()
  const { height: winHeight } = useWindowSize()
  const playMusicInfo = usePlayMusicInfo()
  const musicInfo = (playMusicInfo?.musicInfo ?? {}) as any

  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<LyricCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const doSearch = useCallback(async(kw: string) => {
    const q = kw.trim()
    if (!q) return
    setLoading(true)
    setStatus('正在搜索…')
    try {
      const list = await searchLyricCandidates(q)
      setResults(list)
      setStatus(list.length ? `找到 ${list.length} 个候选，点一条套用` : '没搜到，换个写法试试（如：歌手 歌名）')
    } catch (e: any) {
      setStatus(`搜索失败：${e?.message ?? e}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    const kw = [musicInfo?.singer, musicInfo?.name].filter(Boolean).join(' ').trim()
    setKeyword(kw)
    setResults([])
    if (kw) void doSearch(kw)
    else setStatus('输入歌名或“歌手 歌名”后点搜索')
  }, [visible, musicInfo?.name, musicInfo?.singer, doSearch])

  const apply = useCallback(async(c: LyricCandidate) => {
    setLoading(true)
    setStatus(`正在取词：${c.source} · ${c.title}`)
    try {
      const lrc = await fetchLyricForCandidate(c)
      if (!lrc) {
        setStatus('这个词源没取到内容，换一条试试')
        return
      }
      void saveLyric(musicInfo, { lyric: lrc, manual: true } as any)
      setLyric(lrc)
      // 换了歌词版本，之前的偏移不再适用
      const mid = (musicInfo as any)?.id as string | undefined
      if (mid) resetLyricOffset(mid)
      // setLyric 会把歌词播放器重置到第 0 行，这里重新对齐到当前进度，否则不会自动滚动
      if (playerState.isPlay) {
        try {
          const pos = await getPosition()
          playLyric(Math.max(0, pos * 1000))
        } catch {}
      }
      setStatus(`已套用：${c.source} · ${c.title}`)
      onClose()
    } catch (e: any) {
      setStatus(`取词失败：${e?.message ?? e}`)
    } finally {
      setLoading(false)
    }
  }, [musicInfo, onClose])

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.mask}>
        <View style={{ ...styles.card, backgroundColor: theme['c-content-background'] }} onStartShouldSetResponder={() => true}>
          <View style={{ ...styles.header, borderBottomColor: theme['c-border-background'] }}>
            <Text size={16} color={theme['c-font']}>手动搜索歌词</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={18} color={theme['c-350']} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              style={[styles.input, { color: theme['c-font'], borderColor: theme['c-300'] }]}
              value={keyword}
              onChangeText={setKeyword}
              placeholder="歌手 歌名"
              placeholderTextColor={theme['c-400']}
              onSubmitEditing={() => { void doSearch(keyword) }}
              returnKeyType="search"
              autoCorrect={false}
            />
            <TouchableOpacity style={[styles.btn, { backgroundColor: theme['c-primary'] }]} onPress={() => { void doSearch(keyword) }} disabled={loading}>
              <Text style={styles.btnText}>搜索</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statusRow}>
            <Text style={[styles.statusText, { color: theme['c-400'] }]} numberOfLines={2}>{status}</Text>
            {loading ? <ActivityIndicator color={theme['c-primary']} /> : null}
          </View>

          <ScrollView style={[styles.list, { maxHeight: Math.max(200, winHeight * 0.55) }]}>
            {results.map(c => (
              <TouchableOpacity
                key={c.key}
                style={[styles.item, { borderBottomColor: theme['c-border-background'] }]}
                onPress={() => { void apply(c) }}
              >
                <Text style={[styles.badge, { color: theme['c-primary'], borderColor: theme['c-primary'] }]}>{c.source}</Text>
                <View style={styles.itemMain}>
                  <Text size={14} color={theme['c-font']} numberOfLines={1}>{c.title || '(无标题)'}</Text>
                  <Text style={[styles.itemSub, { color: theme['c-400'] }]} numberOfLines={1}>{c.artist || '未知艺人'}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = createStyle({
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 620, maxHeight: '82%', borderRadius: 10, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  closeBtn: { padding: 2 },
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 },
  input: { flex: 1, height: 40, borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, fontSize: 14 },
  btn: { marginLeft: 8, height: 40, paddingHorizontal: 16, borderRadius: 6, justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  statusText: { fontSize: 12, flex: 1, paddingRight: 8 },
  list: { paddingHorizontal: 16 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5 },
  badge: { fontSize: 10, borderWidth: 0.5, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1, marginRight: 8 },
  itemMain: { flex: 1 },
  itemSub: { fontSize: 12, marginTop: 2 },
})
