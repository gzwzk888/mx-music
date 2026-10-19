import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View, Image} from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { playInTempList } from '@/core/nas/playHelper'
import { playListById } from '@/core/player/player'
import listState from '@/store/list/state'
import { getLocalFiles, getNasIndex, getNasItems } from '@/core/nas/session'
import { nasSongPathText } from '@/core/nas/nasIndex'
import type { NasItem } from '@/core/nas/dlna'
import { SearchIcon } from '@/components/common/PlayIcons'
import { getData, saveData } from '@/plugins/storage'
import { useSettingValue } from '@/store/setting/hook'

const SEARCH_LIST_NAME = '搜索'
const HISTORY_KEY = '@mod_search_history'
const HISTORY_MAX = 20
const SUPPORTED_EXT = new Set(['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'alac', 'mka', 'aiff'])

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

/** 本机 + NAS 已读取曲目 → 统一索引 */
const buildIndex = (): Hit[] => {
  const hits: Hit[] = []

  for (const f of getLocalFiles()) {
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
      name: (item.title || '').trim() || '(未命名)',
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
      album: item.album.trim(),
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

  const build = useCallback((label = '') => {
    const list = buildIndex()
    indexRef.current = list
    setIndex(list)
    const localCount = list.filter(h => h.from == '本机').length
    const nasCount = list.filter(h => h.from == 'NAS').length
    const base = `可搜范围：本机 ${localCount} 首 · NAS ${nasCount} 首`
    setStatus(nasCount
      ? base
      : `${base}（NAS 曲目请先在「NAS 音乐」里打开目录，如 Songs）`)
    if (label) setStatus(prev => `${label}｜${base}`)
    return list
  }, [])

  // 手动刷新：清掉缓存后重建
  const reload = useCallback((label = '') => {
    indexRef.current = null
    if (!keyword.trim()) {
      setIndex([])
      return
    }
    build(label)
  }, [build, keyword])

  useEffect(() => {
    if (!keyword.trim() || indexRef.current) return
    build()
  }, [keyword, build])

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
      setStatus(`正在播放：${hit.name}（结果 ${infos.length} 首已载入「试听列表」）`)
    } catch (e: any) {
      setStatus(`播放失败：${e?.message ?? e}`)
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
            {item.singer || '未知艺人'}{item.album ? ` · ${item.album}` : ''}
          </Text>
          {item.path
            ? <Text style={[styles.itemPath, { color: theme['c-350'] }]} numberOfLines={1} ellipsizeMode="middle">{item.path}</Text>
            : null}
        </View>
        <View style={styles.itemRight}>
          <Text style={[styles.badge, { color: item.from == 'NAS' ? theme['c-primary'] : theme['c-400'], borderColor: item.from == 'NAS' ? theme['c-primary'] : theme['c-300'] }]}>{item.from}</Text>
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
          placeholder="搜索本机与 NAS 的歌曲 / 歌手 / 专辑"
          placeholderTextColor={theme['c-400']}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <TouchableOpacity style={[styles.btn, styles.iconBtn, { borderColor: theme['c-primary'] }]} onPress={() => { reload('已刷新索引') }}>
          <SearchIcon size={18} color={theme['c-primary']} />
        </TouchableOpacity>
      </View>

      <View style={styles.statusRow}>
        <Text style={[styles.statusText, { color: theme['c-400'] }]} numberOfLines={2}>
          {keyword ? `找到 ${results.length} 首` : status}
        </Text>
        {loading ? <ActivityIndicator color={theme['c-primary']} /> : null}
      </View>

      {!keyword.trim() && showHistory && history.length
        ? <View style={styles.historyBox}>
          <View style={styles.historyHead}>
            <Text style={[styles.historyLabel, { color: theme['c-350'] }]}>历史搜索</Text>
            <TouchableOpacity onPress={() => { saveHistory([]) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.historyLabel, { color: theme['c-400'] }]}>清空</Text>
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

      <FlatList
        data={results}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Image source={require('@/resources/images/mx_logo.png')} style={styles.emptyLogo} resizeMode="contain" />
            <Text style={[styles.empty, { color: theme['c-400'] }]}>
              {keyword ? '没有匹配的歌曲' : '输入关键词开始搜索（本机已扫描 + NAS 已读取的曲目）'}
            </Text>
          </View>
        }
      />
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
  emptyBox: { alignItems: 'center', paddingTop: 50, gap: 12 },
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
  empty: { fontSize: 12, textAlign: 'center', marginTop: 30 },
})
