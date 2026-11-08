import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View, Image} from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { playInTempList } from '@/core/nas/playHelper'
import { playListById } from '@/core/player/player'
import listState from '@/store/list/state'
import { ensureLoaded, getSongs } from '@/core/local/dirs'
import { getLocalFiles, getNasIndex, getNasItems, restoreLocalFiles, restoreNasIndex } from '@/core/nas/session'
import { nasSongPathText } from '@/core/nas/nasIndex'
import type { NasItem } from '@/core/nas/dlna'
import { SearchIcon } from '@/components/common/PlayIcons'
import { getData, saveData } from '@/plugins/storage'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n, getMessage } from '@/lang'

const SEARCH_LIST_NAME = '搜索'
const HISTORY_KEY = '@mod_search_history'
const HISTORY_MAX = 20
const SUPPORTED_EXT = new Set(['flac', 'wav', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'alac', 'mka', 'mp2'])

interface Hit {
  id: string
  name: string
  singer: string
  album: string
  /** 展示与匹配用的路径（已去掉协议/主机/存储根前缀） */
  path: string
  interval: string | null
  from: '本机' | 'NAS'
  musicInfo: LX.Music.MusicInfoLocal
}

const extOf = (path: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(path)
  return m ? m[1].toLowerCase() : ''
}

/**
 * 结果行展示用路径：去掉协议、主机、Android 存储根前缀
 * 本机 /storage/emulated/0/Music/A/01.flac → Music/A/01.flac
 */
const shortPath = (raw?: string | null): string => {
  if (!raw) return ''
  let s = raw.trim()
  if (!s) return ''
  // content:// 之类不暴露真实路径的，宁可不显示也不露一串 ID
  if (/^content:\/\//i.test(s)) return ''
  s = s.replace(/^file:\/\//i, '')
  s = s.replace(/^https?:\/\/[^/]+\/?/i, '')
  s = s.replace(/^\/storage\/emulated\/\d+\/?/i, '')
  s = s.replace(/^\/storage\/[0-9A-Za-z._-]+\/?/, '')
  s = s.replace(/^\/sdcard\/?/i, '')
  s = s.replace(/[?#].*$/, '')
  try { s = decodeURIComponent(s) } catch { /* 保留原串 */ }
  return s
}

/**
 * NAS 显示用路径：DLNA 的 res URL 是对象 ID，不能当路径用；
 * 统一走 core/nas/nasIndex 里的 nasSongPathText
 */
const nasPathText = nasSongPathText

const fmtDuration = (ms: number): string | null => {
  if (!Number.isFinite(ms) || ms <= 0) return null
  const total = Math.floor(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * 本机 + NAS 已读取曲目 → 统一索引
 * 冷启动时内存里可能还是空的（本机扫描缓存 / NAS 索引都要从磁盘异步读回），
 * 所以先等这两个 restore 完成再建索引，否则只会搜到空或只有本机。
 */
const buildIndex = async(): Promise<Hit[]> => {
  await Promise.all([
    ensureLoaded().catch(() => null),
    restoreLocalFiles().catch(() => null),
    restoreNasIndex().catch(() => null),
  ])
  const hits: Hit[] = []

  // 本机曲库以「音乐库」页同一个数据源（core/local/dirs）为准；
  // 旧版搜索读的是 NAS 会话里那份扫描缓存，实际常常是空的 → 搜本机永远 0 条
  const dirSongs = getSongs()
  const localRows = dirSongs.length
    ? dirSongs.map(s => ({ path: s.path, title: s.title, fileName: s.fileName, artist: s.artist, album: s.album, duration: s.duration }))
    : getLocalFiles().map(f => ({ path: f.path, title: f.title, fileName: f.fileName, artist: f.artist, album: f.album, duration: f.duration }))

  for (const f of localRows) {
    const name = (f.title ?? f.fileName ?? f.path.split('/').pop() ?? '').trim()
    if (!name) continue
    const musicInfo: LX.Music.MusicInfoLocal = {
      id: `local_${f.path}`,
      name,
      singer: (f.artist ?? '').trim(),
      source: 'local',
      interval: fmtDuration(f.duration),
      meta: {
        songId: f.path,
        albumName: (f.album ?? '').trim(),
        picUrl: null,
        filePath: f.path,
        ext: extOf(f.path),
      },
    }
    hits.push({
      id: musicInfo.id,
      name,
      singer: musicInfo.singer,
      album: (f.album ?? '').trim(),
      path: shortPath(f.path),
      interval: musicInfo.interval,
      from: '本机',
      musicInfo,
    })
  }

  const nasIndex = getNasIndex()
  const nasSource = nasIndex?.songs?.length
    ? nasIndex.songs
    : (getNasItems() as NasItem[]).filter(i => !i.isContainer && i.url).map(i => ({
        id: i.id, title: i.title, artist: i.artist, album: i.album, url: i.url, ext: i.ext, interval: i.interval, folder: '',
      }))

  for (const item of nasSource) {
    if (!item.url || !SUPPORTED_EXT.has(item.ext)) continue
    const musicInfo: LX.Music.MusicInfoLocal = {
      id: `nas_${item.id}`,
      name: (item.title || '').trim() || getMessage('lib_untitled'),
      singer: (item.artist || '').trim(),
      source: 'local',
      interval: item.interval ?? null,
      meta: {
        songId: item.url,
        albumName: (item.album || '').trim(),
        picUrl: null,
        filePath: item.url,
        ext: item.ext,
      },
    }
    hits.push({
      id: musicInfo.id,
      name: musicInfo.name,
      singer: musicInfo.singer,
      // NAS 索引里部分曲目没有 album 字段，这里必须兜底，否则整次建索引会抛异常 → 搜索结果永远为空
      album: String(item.album ?? '').trim(),
      path: nasPathText(item.folder, musicInfo.name, item.ext),
      interval: musicInfo.interval,
      from: 'NAS',
      musicInfo,
    })
  }

  return hits
}

export default () => {
  const theme = useTheme()
  const t = useI18n()
  const [keyword, setKeyword] = useState('')
  const [index, setIndex] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const showHistory = useSettingValue('search.isShowHistorySearch')
  const [history, setHistory] = useState<string[]>([])

  // 载入历史搜索
  useEffect(() => {
    void getData<string[]>(HISTORY_KEY).then(list => {
      if (Array.isArray(list)) setHistory(list.filter(k => typeof k == 'string' && k.trim()))
    }).catch(() => {})
  }, [])

  const saveHistory = useCallback((list: string[]) => {
    setHistory(list)
    void saveData(HISTORY_KEY, list).catch(() => {})
  }, [])

  const pushHistory = useCallback((kw: string) => {
    const key = kw.trim()
    if (!key) return
    setHistory(prev => {
      const next = [key, ...prev.filter(k => k != key)].slice(0, HISTORY_MAX)
      void saveData(HISTORY_KEY, next).catch(() => {})
      return next
    })
  }, [])


  // 索引延迟到「第一次输入关键词」时才构建，避免启动时遍历上万首
  const indexRef = useRef<Hit[] | null>(null)

  const build = useCallback(async(label = '') => {
    setLoading(true)
    try {
      const list = await buildIndex()
      indexRef.current = list
      setIndex(list)
      const localCount = list.filter(h => h.from == '本机').length
      const nasCount = list.filter(h => h.from == 'NAS').length
      const base = getMessage('search_scope', { local: localCount, nas: nasCount })
      setStatus(nasCount
        ? base
        : `${base}${getMessage('search_scope_tail')}`)
      if (label) setStatus(`${label}｜${base}`)
      return list
    } catch (e: any) {
      // 索引构建异常（比如某条 NAS 记录字段缺失）不能让界面停在一片空白
      indexRef.current = null
      setIndex([])
      setStatus(`${getMessage('search_index_error')}：${String(e?.message ?? e)}`)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  // 手动刷新：清掉缓存后重建
  const reload = useCallback((label = '') => {
    indexRef.current = null
    setIndex([])
    if (!keyword.trim()) return
    void build(label)
  }, [build, keyword])

  useEffect(() => {
    if (!keyword.trim() || indexRef.current) return
    void build()
  }, [keyword, build])

  // NAS 全库索引是异步读回/稍后重建的：一到就作废缓存重建，否则本次会话只搜得到本机
  const keywordRef = useRef('')
  useEffect(() => { keywordRef.current = keyword }, [keyword])
  useEffect(() => {
    const onIndexUpdated = () => {
      indexRef.current = null
      if (keywordRef.current.trim()) void build()
      else setIndex([])
    }
    global.state_event.on('mxNasIndexUpdated', onIndexUpdated)
    return () => { global.state_event.off('mxNasIndexUpdated', onIndexUpdated) }
  }, [build])

  const results = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return []
    return index.filter(h =>
      h.name.toLowerCase().includes(kw) ||
      h.singer.toLowerCase().includes(kw) ||
      h.album.toLowerCase().includes(kw) ||
      h.path.toLowerCase().includes(kw),
    ).slice(0, 500)
  }, [keyword, index])

  // 输入停顿 1.2 秒后记入历史（有结果才记）
  useEffect(() => {
    const kw = keyword.trim()
    if (!kw || !results.length) return
    const t = setTimeout(() => { pushHistory(kw) }, 1200)
    return () => clearTimeout(t)
  }, [keyword, results.length, pushHistory])

  const handlePlay = useCallback(async(hit: Hit) => {
    setLoading(true)
    try {
      const infos = results.length ? results.map(r => r.musicInfo) : [hit.musicInfo]
      await playInTempList(infos, hit.musicInfo.id)
      setStatus(getMessage('search_playing', { name: hit.name, n: infos.length }))
    } catch (e: any) {
      setStatus(getMessage('search_play_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setLoading(false)
    }
  }, [results])

  const renderItem = useCallback(({ item }: { item: Hit }) => {
    return (
      <TouchableOpacity style={[styles.item, { borderBottomColor: theme['c-border-background'] }]} onPress={() => { void handlePlay(item) }}>
        <View style={styles.itemMain}>
          <Text style={[styles.itemTitle, { color: theme['c-font'] }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.itemSub, { color: theme['c-400'] }]} numberOfLines={1}>
            {item.singer || t('lib_unknown_artist')}{item.album ? ` · ${item.album}` : ''}
          </Text>
          {item.path
            ? <Text style={[styles.itemPath, { color: theme['c-350'] }]} numberOfLines={1} ellipsizeMode="middle">{item.path}</Text>
            : null}
        </View>
        <View style={styles.itemRight}>
          <Text style={[styles.badge, { color: item.from == 'NAS' ? theme['c-primary'] : theme['c-400'], borderColor: item.from == 'NAS' ? theme['c-primary'] : theme['c-300'] }]}>{item.from == 'NAS' ? 'NAS' : t('lib_badge_local')}</Text>
          {item.interval ? <Text style={[styles.itemSub, { color: theme['c-400'] }]}>{item.interval}</Text> : null}
        </View>
      </TouchableOpacity>
    )
  }, [theme, handlePlay])

  return (
    <View style={[styles.container, { backgroundColor: theme['c-content-background'] }]}>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { color: theme['c-font'], borderColor: theme['c-300'] }]}
          value={keyword}
          onChangeText={setKeyword}
          placeholder={t('search_placeholder')}
          placeholderTextColor={theme['c-400']}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <TouchableOpacity style={[styles.btn, styles.iconBtn, { borderColor: theme['c-primary'] }]} onPress={() => { reload(t('search_refreshed')) }}>
          <SearchIcon size={18} color={theme['c-primary']} />
        </TouchableOpacity>
      </View>

      <View style={styles.statusRow}>
        <Text style={[styles.statusText, { color: theme['c-400'] }]} numberOfLines={2}>
          {keyword ? `${t('search_found', { n: results.length })}${status ? `｜${status}` : ''}` : status}
        </Text>
        {loading ? <ActivityIndicator color={theme['c-primary']} /> : null}
      </View>

      {!keyword.trim() && showHistory && history.length
        ? <View style={styles.historyBox}>
          <View style={styles.historyHead}>
            <Text style={[styles.historyLabel, { color: theme['c-350'] }]}>{t('search_history')}</Text>
            <TouchableOpacity onPress={() => { saveHistory([]) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.historyLabel, { color: theme['c-400'] }]}>{t('search_clear')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.chips}>
            {history.map(k => (
              <TouchableOpacity key={k} style={[styles.chip, { borderColor: theme['c-300'] }]} onPress={() => { setKeyword(k) }}>
                <Text style={[styles.chipText, { color: theme['c-font'] }]} numberOfLines={1}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        : null}

      {results.length === 0 ? (
        <View style={styles.emptyBox}>
          <Image source={require('@/resources/images/mx_logo.png')} style={styles.emptyLogo} resizeMode="contain" />
          <Text style={[styles.empty, { color: theme['c-400'] }]}>{keyword ? getMessage('search_no_match') : getMessage('search_idle_tip')}</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  )
}

const styles = createStyle({
  historyBox: {
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  historyLabel: {
    fontSize: 12,
  },
  chipText: {
    fontSize: 12,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: '100%',
  },
  emptyBox: { alignItems: 'center', paddingTop: 26, gap: 12, paddingHorizontal: 24 },
  emptyLogo: { width: 64, height: 64, borderRadius: 14, opacity: 0.35 },
  container: { flex: 1, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  input: { flex: 1, height: 40, borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, fontSize: 14 },
  btn: { marginLeft: 8, height: 40, paddingHorizontal: 14, borderRadius: 6, justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 14 },
  iconBtn: { backgroundColor: 'transparent', borderWidth: 1, width: 40, alignItems: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  statusText: { fontSize: 12, flex: 1 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5 },
  itemMain: { flex: 1, paddingRight: 8 },
  itemTitle: { fontSize: 15 },
  itemSub: { fontSize: 12, marginTop: 2 },
  itemPath: { fontSize: 10, marginTop: 2, opacity: 0.85 },
  itemRight: { alignItems: 'flex-end' },
  badge: { fontSize: 10, borderWidth: 0.5, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1, marginBottom: 3 },
  empty: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 18, flexShrink: 0 },
})
