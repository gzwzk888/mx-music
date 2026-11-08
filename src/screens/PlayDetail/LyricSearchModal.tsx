import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/lang'
import { ActivityIndicator, Modal, ScrollView, TextInput, TouchableOpacity, View } from 'react-native'
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
import playerAction from '@/store/player/action'
import {
  fetchLyricForCandidate,
  searchLyricCandidates,
  searchMiniLyricsCandidates,
  searchMoreLyricCandidates,
  diagnoseMiniLyrics,
  getMiniLyricsError,
  type LyricCandidate,
} from '@/core/nas/lyricSearch'
import { resetLyricOffset } from '@/core/lyricOffset'

/** 最多显示多少条候选（再多也没人翻） */
const MAX_CANDIDATES = 50

/** 合并去重并限制上限 */
const mergeCandidates = (prev: LyricCandidate[], add: LyricCandidate[]): LyricCandidate[] => {
  const seen = new Set(prev.map(c => c.key))
  const next = [...prev]
  for (const c of add) {
    if (seen.has(c.key)) continue
    seen.add(c.key)
    next.push(c)
    if (next.length >= MAX_CANDIDATES) break
  }
  return next
}

/** 各源命中数，用于状态行排查 */
const sourceSummary = (list: LyricCandidate[]) => {
  const count: Record<string, number> = {}
  for (const c of list) count[c.source] = (count[c.source] ?? 0) + 1
  return ['酷狗', 'QQ音乐', 'LRCLIB', 'MiniLyrics']
    .map(s => `${s} ${count[s] ?? 0}`)
    .join(' · ')
}

/**
 * 手动搜歌词（歌在源里没搜到时兜底）
 * 两阶段：先出快源（酷狗/QQ/LRCLIB，几十~几百毫秒），MiniLyrics 随后补（可能几秒）
 */
export default ({ visible, onClose }: { visible: boolean, onClose: () => void }) => {
  const t = useI18n()
  const theme = useTheme()
  const { height: winHeight } = useWindowSize()
  const playMusicInfo = usePlayMusicInfo()
  const musicInfo = (playMusicInfo?.musicInfo ?? {}) as any

  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<LyricCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [status, setStatus] = useState('')
  const resultsRef = useRef<LyricCandidate[]>([])

  const applyResults = useCallback((next: LyricCandidate[]) => {
    resultsRef.current = next
    setResults(next)
  }, [])

  const doSearch = useCallback(async(kw: string) => {
    const q = kw.trim()
    if (!q) return
    setLoading(true)
    setStatus(t('lsearch_searching'))
    applyResults([])

    // 阶段 1：快源
    let fast: LyricCandidate[] = []
    try {
      fast = await searchLyricCandidates(q)
    } catch (e: any) {
      setStatus(t('lsearch_fail', { msg: String(e?.message ?? e) }))
    }
    const first = mergeCandidates([], fast)
    applyResults(first)
    setLoading(false)

    // 阶段 2：MiniLyrics（慢，异步补）
    setStatus(`${first.length} · ${sourceSummary(first)} · ${t('lsearch_ml_wait')}`)

    setLoadingMore(true)
    try {
      const ml = await searchMiniLyricsCandidates(q, 0)
      const next = mergeCandidates(resultsRef.current, ml)
      applyResults(next)
      const err = getMiniLyricsError()
      if (err) {
        setStatus(`${next.length} · ${sourceSummary(next)} · ${t('lsearch_ml_fail', { msg: err })}`)
        // 自动跑一次自检，把「网络不通」还是「POST 发不出去」写进状态行
        const diag = await diagnoseMiniLyrics()
        setStatus(`${next.length} · ${sourceSummary(next)} · ${t('lsearch_ml_fail', { msg: err })}\n${diag}`)
      } else if (!ml.length) setStatus(`${next.length} · ${sourceSummary(next)} · ${t('lsearch_ml_empty')}`)
      else setStatus(t('lsearch_count', { n: next.length, src: sourceSummary(next) }))
    } catch (e: any) {
      setStatus(`${resultsRef.current.length} · ${sourceSummary(resultsRef.current)} · ${t('lsearch_fail', { msg: e?.message ?? e })}`)
    } finally {
      setLoadingMore(false)
    }
  }, [applyResults])

  useEffect(() => {
    if (!visible) return
    const kw = [musicInfo?.singer, musicInfo?.name].filter(Boolean).join(' ').trim()
    setKeyword(kw)
    applyResults([])
    if (kw) void doSearch(kw)
    else setStatus(t('lsearch_hint'))
  }, [visible, musicInfo?.name, musicInfo?.singer, doSearch, applyResults])

  /** 翻页：继续取 MiniLyrics 后面的候选，不重复 */
  const loadMore = useCallback(async() => {
    const q = keyword.trim()
    if (!q || loadingMore || loading) return
    if (resultsRef.current.length >= MAX_CANDIDATES) return
    setLoadingMore(true)
    try {
      const more = await searchMoreLyricCandidates(q, resultsRef.current.map(c => c.key))
      if (!more.length) {
        setStatus(t('lsearch_nomore'))
        return
      }
      const next = mergeCandidates(resultsRef.current, more)
      applyResults(next)
      setStatus(t('lsearch_loaded', { n: next.length, max: MAX_CANDIDATES }))
    } catch (e: any) {
      setStatus(t('lsearch_loadfail', { msg: String(e?.message ?? e) }))
    } finally {
      setLoadingMore(false)
    }
  }, [applyResults, keyword, loading, loadingMore])

  const apply = useCallback(async(c: LyricCandidate) => {
    setLoading(true)
    setStatus(t('lsearch_loading_item', { src: c.source, title: c.title }))
    try {
      const lrc = await fetchLyricForCandidate(c)
      if (!lrc) {
        setStatus(t('lsearch_empty_src'))
        return
      }
      void saveLyric(musicInfo, { lyric: lrc, manual: true } as any)
      // 关键：同步写回当前播放信息，否则歌词页重新挂载时仍按「没有歌词」渲染
      playerAction.setMusicInfo({ lrc, tlrc: null, rlrc: null, lxlrc: null })
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
      setStatus(t('lsearch_applied', { src: c.source, title: c.title }))
      onClose()
    } catch (e: any) {
      setStatus(t('lsearch_take_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setLoading(false)
    }
  }, [musicInfo, onClose])

  const canLoadMore = results.length > 0 && results.length < MAX_CANDIDATES
  const listMaxHeight = useMemo(() => Math.max(200, winHeight * 0.55), [winHeight])

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.mask}>
        <View style={{ ...styles.card, backgroundColor: theme['c-content-background'] }} onStartShouldSetResponder={() => true}>
          <View style={{ ...styles.header, borderBottomColor: theme['c-border-background'] }}>
            <Text size={16} color={theme['c-font']}>{t('lsearch_manual')}</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={18} color={theme['c-350']} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              style={[styles.input, { color: theme['c-font'], borderColor: theme['c-300'] }]}
              value={keyword}
              onChangeText={setKeyword}
              placeholder={t('lsearch_ph')}
              placeholderTextColor={theme['c-400']}
              onSubmitEditing={() => { void doSearch(keyword) }}
              returnKeyType="search"
              autoCorrect={false}
            />
            <TouchableOpacity style={[styles.btn, { backgroundColor: theme['c-primary'] }]} onPress={() => { void doSearch(keyword) }} disabled={loading}>
              <Text style={styles.btnText}>{t('lsearch_search')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statusRow}>
            <Text style={[styles.statusText, { color: theme['c-400'] }]} numberOfLines={3}>{status}</Text>
            {loading || loadingMore ? <ActivityIndicator color={theme['c-primary']} /> : null}
          </View>

          <ScrollView style={[styles.list, { maxHeight: listMaxHeight }]}>
            {results.map(c => (
              <TouchableOpacity
                key={c.key}
                style={[styles.item, { borderBottomColor: theme['c-border-background'] }]}
                onPress={() => { void apply(c) }}
              >
                <Text style={[styles.badge, { color: theme['c-primary'], borderColor: theme['c-primary'] }]}>{c.source}</Text>
                <View style={styles.itemMain}>
                  <Text size={14} color={theme['c-font']} numberOfLines={1}>{c.title || t('lsearch_untitled')}</Text>
                  <Text style={[styles.itemSub, { color: theme['c-400'] }]} numberOfLines={1}>
                    {[c.artist || t('lib_unknown_artist'), c.album].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}

            {canLoadMore
              ? (
                <TouchableOpacity style={[styles.moreBtn, { borderColor: theme['c-300'] }]} onPress={() => { void loadMore() }} disabled={loadingMore}>
                  <Text size={13} color={theme['c-primary']}>{loadingMore ? t('lsearch_loading') : t('lsearch_more', { n: results.length, max: MAX_CANDIDATES })}</Text>
                </TouchableOpacity>
                )
              : null}
            {results.length >= MAX_CANDIDATES
              ? <Text style={[styles.moreTip, { color: theme['c-450'] }]} size={12}>{t('lsearch_cap', { n: MAX_CANDIDATES })}</Text>
              : null}
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
  moreBtn: { marginVertical: 12, borderWidth: 0.5, borderRadius: 6, paddingVertical: 9, alignItems: 'center' },
  moreTip: { textAlign: 'center', paddingVertical: 12 },
})
