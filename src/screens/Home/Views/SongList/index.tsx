import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { useNavActiveId } from '@/store/common/hook'
import { useWindowSize } from '@/utils/hooks'
import { createStyle } from '@/utils/tools'
import { playInTempList } from '@/core/nas/playHelper'
import { getRecentSongStats, loadPlayStats, type SongStat } from '@/core/nas/playStats'
import { getLocalFiles, getNasIndex, getNasItems, isLocalCoverStale, isNasReachable, markNasUnreachable, refreshLocalFiles, restoreLocalFiles, restoreNasIndex } from '@/core/nas/session'
import { toMusicInfo } from '@/core/nas/dlna'
import type { NasSongIndex } from '@/core/nas/nasIndex'
import type { LocalAudioFile } from '@/utils/nativeModules/mediaScan'
import Image from '@/components/common/Image'

type Tab = 'recent' | 'random'

const SUPPORTED_EXT = new Set(['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'alac', 'mka', 'aiff'])
const GAP = 10
const RECENT_N = 100
const RANDOM_N = 100

const extOf = (path: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(path)
  return m ? m[1].toLowerCase() : ''
}

const norm = (v: string) => v.toLowerCase().replace(/[\s\-_().（）[\]·,，、&/]/g, '')
/** 去重键：歌名 + 歌手（同曲不同来源/不同 id 只留一条） */
const songKey = (name: string, singer: string) => `${norm(name)}|${norm(singer)}`

interface SongCard {
  key: string
  name: string
  singer: string
  album: string
  /** 歌曲自身封面；无则 null → 组件回落 logo */
  picUrl: string | null
  /** 来源：用于列表里显示「本机 / NAS」，也用于离线时过滤 */
  from: '本机' | 'NAS'
  info: LX.Music.MusicInfoLocal
}

/** 播放记录里的 filePath 是 http(s) 就是 NAS，否则当本机 */
const isNasPath = (path: string) => /^https?:\/\//i.test(path || '')

const localToCard = (f: LocalAudioFile): SongCard | null => {
  const name = (f.title || f.fileName || f.path.split('/').pop() || '').trim()
  if (!name) return null
  const singer = (f.artist ?? '').trim()
  const album = (f.album ?? '').trim()
  const picUrl = f.picUrl ?? null
  return {
    key: songKey(name, singer),
    name,
    singer,
    album,
    picUrl,
    from: '本机',
    info: {
      id: `local_${f.path}`,
      name,
      singer,
      source: 'local',
      interval: null,
      meta: { songId: f.path, albumName: album, picUrl, filePath: f.path, ext: extOf(f.path) },
    },
  }
}

const nasIndexToCard = (s: NasSongIndex): SongCard | null => {
  const name = (s.title ?? '').trim()
  if (!name) return null
  const singer = (s.artist ?? '').trim()
  const album = (s.album ?? '').trim()
  const picUrl = s.artUrl ?? null
  return {
    key: songKey(name, singer),
    name,
    singer,
    album,
    picUrl,
    from: 'NAS',
    info: {
      id: `nas_${s.id}`,
      name,
      singer,
      source: 'local',
      interval: s.interval,
      meta: {
        songId: s.url,
        albumName: album,
        picUrl,
        filePath: s.url,
        ext: s.ext,
        ...(s.cueStart != null ? { cueStart: s.cueStart, cueEnd: s.cueEnd } : {}),
      },
    },
  }
}

/**
 * 播放记录 → 卡片
 *   1. 能对上 NAS 索引的，用索引信息（封面 artUrl、CUE 区间、真实目录）
 *   2. 能对上本机曲库的，用 MediaStore 的封面补上（搜索页播的歌记录里 picUrl 是空的）
 *   3. 都对不上就退回记录里存的信息，来源按 filePath 判断
 */
const statToCard = (
  s: SongStat,
  byUrl: Map<string, NasSongIndex>,
  localByPath: Map<string, LocalAudioFile>,
): SongCard => {
  const hit = byUrl.get(s.filePath)
  if (hit) {
    const card = nasIndexToCard(hit)
    if (card) return card
  }
  const local = localByPath.get(s.filePath)
  // 曲库里的封面是最新扫描的（albumart URI 随媒体库重建会变），优先用它；
  // 记录里存的那份可能已经失效，只能当兜底，否则会出现「曲库有封面却显示 logo」
  const picUrl = local?.picUrl ?? s.picUrl ?? null
  return {
    key: songKey(s.name, s.singer),
    name: s.name,
    singer: s.singer,
    album: s.album || (local?.album ?? '').trim(),
    picUrl,
    from: isNasPath(s.filePath) ? 'NAS' : '本机',
    info: {
      id: s.id,
      name: s.name,
      singer: s.singer,
      source: 'local',
      interval: null,
      meta: { songId: s.filePath, albumName: s.album, picUrl, filePath: s.filePath, ext: extOf(s.filePath) },
    },
  }
}

const shuffle = <T,>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t
  }
  return arr
}

export default () => {
  const theme = useTheme()
  const { width: winWidth } = useWindowSize()
  const [tab, setTab] = useState<Tab>('recent')
  const [recent, setRecent] = useState<SongCard[]>([])
  const [random, setRandom] = useState<SongCard[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  // 列表容器的实测宽度（宽屏有侧栏时比屏幕窄，不能拿屏幕宽度算）
  const [listWidth, setListWidth] = useState(0)
  // 上一批随机结果：刷新时优先排除，保证「换一批」
  const lastRandom = useRef<Set<string>>(new Set())

  // 每格约 150dp：手机 3 列，平板 4–8 列
  const columns = useMemo(() => {
    const w = listWidth || winWidth
    const byWidth = Math.round(w / 150)
    return Math.max(w < 600 ? 3 : 4, Math.min(8, byWidth))
  }, [listWidth, winWidth])

  const cellWidth = useMemo(() => {
    const w = listWidth || winWidth
    const usable = w - GAP * columns
    return Math.max(72, Math.floor(usable / columns))
  }, [listWidth, winWidth, columns])

  const navActiveId = useNavActiveId()
  const active = navActiveId == 'nav_songlist'

  const reloadRecent = useCallback(async() => {
    setLoading(true)
    try {
      await loadPlayStats()
      // 本机曲库可能是 b127 之前的旧缓存（没有封面字段）→ 补扫一次
      await restoreLocalFiles()
      if (isLocalCoverStale()) await refreshLocalFiles()
      const idx = getNasIndex() ?? await restoreNasIndex()
      const byUrl = new Map<string, NasSongIndex>()
      if (idx?.songs?.length) for (const s of idx.songs) byUrl.set(s.url, s)

      // 本机曲库：用 filePath 反查封面/专辑，补上历史记录里缺的字段
      const localByPath = new Map<string, LocalAudioFile>()
      for (const f of getLocalFiles()) localByPath.set(f.path, f)

      const seen = new Set<string>()
      const list: SongCard[] = []
      for (const stat of getRecentSongStats(RECENT_N)) {
        const card = statToCard(stat, byUrl, localByPath)
        if (seen.has(card.key)) continue
        seen.add(card.key)
        list.push(card)
        if (list.length >= RECENT_N) break
      }
      setRecent(list)
      setStatus(list.length
        ? `最近 ${list.length} 首 · 按播放时间倒序`
        : '还没有播放记录：播几首歌后这里会出现')
    } catch (e: any) {
      setStatus(`读取播放记录失败：${e?.message ?? e}`)
    } finally {
      setLoading(false)
    }
  }, [])

  // 池子缓存：30 秒内复用，避免每次点「随机100」都重建 1.5 万条卡片
  const poolRef = useRef<{ cards: SongCard[], localCount: number, nasCount: number, nasOnline: boolean, at: number } | null>(null)

  const buildPool = useCallback(async(forceProbe = false) => {
    // 先看 NAS 在不在：离开家时只装本机，避免抽到播不了的歌
    const nasOnline = await isNasReachable(forceProbe)

    // 本机曲库若是旧缓存（b127 之前扫的，没有 picUrl），补扫一次拿封面——纯本地操作
    await restoreLocalFiles()
    if (isLocalCoverStale()) {
      const ok = await refreshLocalFiles()
      if (ok) poolRef.current = null
    }

    const cached = poolRef.current
    if (cached && cached.nasOnline === nasOnline && Date.now() - cached.at < 30000) return cached

    const cards: SongCard[] = []
    const seen = new Set<string>()
    let localCount = 0
    let nasCount = 0

    const push = (c: SongCard | null, fromNas: boolean) => {
      if (!c) return
      if (seen.has(c.key)) return
      seen.add(c.key)
      cards.push(c)
      if (fromNas) nasCount++ ; else localCount++
    }

    for (const f of getLocalFiles()) push(localToCard(f), false)

    if (nasOnline) {
      const idx = getNasIndex() ?? await restoreNasIndex()
      if (idx?.songs?.length) {
        for (const s of idx.songs) push(nasIndexToCard(s), true)
      } else {
        // 没有全库索引时退回当前 NAS 目录
        for (const item of getNasItems()) {
          if (item.isContainer || !item.url || !SUPPORTED_EXT.has(item.ext)) continue
          const info = toMusicInfo(item)
          const name = info.name.trim()
          if (!name) continue
          push({
            key: songKey(name, info.singer),
            name,
            singer: info.singer,
            album: (info.meta.albumName ?? '').trim(),
            picUrl: info.meta.picUrl ?? null,
            from: 'NAS',
            info,
          }, true)
        }
      }
    }

    const result = { cards, localCount, nasCount, nasOnline, at: Date.now() }
    poolRef.current = result
    return result
  }, [])

  // 防重入：连点「随机100」不会同时抽两次
  const pickingRef = useRef(false)

  const reloadRandom = useCallback(async(forceProbe = false) => {
    if (pickingRef.current) return
    pickingRef.current = true
    setLoading(true)
    try {
      const { cards, localCount, nasCount, nasOnline } = await buildPool(forceProbe)
      const prev = lastRandom.current
      const fresh = cards.filter(c => !prev.has(c.key))
      // 池子够大时只从上一批没出现过的里抽，刷新必然换一批
      const source = fresh.length >= RANDOM_N ? fresh : cards
      const picked = shuffle(source.slice()).slice(0, RANDOM_N)
      lastRandom.current = new Set(picked.map(c => c.key))
      setRandom(picked)
      setStatus(picked.length
        ? (nasOnline
            ? `随机 ${picked.length} 首 · 曲库 ${cards.length}（本机 ${localCount} / NAS ${nasCount}）`
            : `随机 ${picked.length} 首 · 仅本机 ${localCount} 首（NAS 未连接）`)
        : '曲库为空：先扫描本机音乐或连接 NAS')
    } catch (e: any) {
      setStatus(`生成随机列表失败：${e?.message ?? e}`)
    } finally {
      pickingRef.current = false
      setLoading(false)
    }
  }, [buildPool])

  useEffect(() => {
    if (!active) return
    if (tab == 'recent') void reloadRecent()
    else if (!random.length) void reloadRandom()
  }, [active, tab, reloadRecent, reloadRandom, random.length])

  const playSong = useCallback(async(card: SongCard) => {
    const list = tab == 'recent' ? recent : random
    try {
      await playInTempList(list.map(c => c.info), card.info.id)
      setStatus(`正在播放：${card.singer ? `${card.singer} - ${card.name}` : card.name}`)
    } catch (e: any) {
      // NAS 曲目播不了 → 立刻标记离线，下次进歌单只装本机
      if (card.from === 'NAS') markNasUnreachable()
      setStatus(`播放失败：${e?.message ?? e}${card.from === 'NAS' ? '（NAS 可能已断开）' : ''}`)
    }
  }, [tab, recent, random])

  const renderItem = useCallback(({ item }: { item: SongCard }) => (
    <TouchableOpacity style={[styles.cell, { width: cellWidth }]} onPress={() => { void playSong(item) }}>
      <Image url={item.picUrl ?? ''} style={{ width: cellWidth, height: cellWidth, borderRadius: 6 }} />
      <Text style={[styles.cellTitle, { color: theme['c-font'], width: cellWidth }]} numberOfLines={1}>{item.album || '未知专辑'}</Text>
      <Text style={[styles.cellSub, { color: theme['c-400'], width: cellWidth }]} numberOfLines={1}>
        {item.singer ? `${item.singer} - ${item.name}` : item.name}
      </Text>
      <Text style={[styles.cellSrc, { color: item.from == 'NAS' ? theme['c-primary'] : theme['c-400'], width: cellWidth }]} numberOfLines={1}>
        {item.from}
      </Text>
    </TouchableOpacity>
  ), [cellWidth, theme, playSong])

  const list = tab == 'recent' ? recent : random

  return (
    <View style={[styles.container, { backgroundColor: theme['c-content-background'] }]}>
      <View style={styles.tabs}>
        {([['recent', '最近'], ['random', '随机100']] as Array<[Tab, string]>).map(([id, label]) => (
          <TouchableOpacity
            key={id}
            style={[styles.tab, tab == id ? { borderBottomColor: theme['c-primary'], borderBottomWidth: 2 } : null]}
            onPress={() => {
              if (id == 'random') {
                // 点「随机100」等同刷新：已经在随机栏就重抽一批，否则切过去同时重抽
                setTab('random')
                void reloadRandom(true)
              } else {
                setTab('recent')
              }
            }}
          >
            <Text style={[styles.tabText, { color: tab == id ? theme['c-primary'] : theme['c-400'] }]}>{label}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.spacer} />
        <TouchableOpacity style={styles.refresh} onPress={() => { if (tab == 'recent') void reloadRecent(); else void reloadRandom(true) }}>
          <Text style={[styles.refreshText, { color: theme['c-primary'] }]}>刷新</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statusRow}>
        <Text style={[styles.statusText, { color: theme['c-400'] }]} numberOfLines={2}>{status}</Text>
        {loading ? <ActivityIndicator color={theme['c-primary']} /> : null}
      </View>

      <View style={styles.gridWrap} onLayout={e => { setListWidth(e.nativeEvent.layout.width) }}>
        <FlatList
          key={`${tab}-${columns}`}
          data={list}
          numColumns={columns}
          columnWrapperStyle={styles.gridRow}
          keyExtractor={item => item.key}
          renderItem={renderItem}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme['c-400'] }]}>
              {loading ? '正在加载…' : (tab == 'recent' ? '还没有播放记录' : '暂无数据')}
            </Text>
          }
        />
      </View>
    </View>
  )
}

const styles = createStyle({
  container: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  tabs: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 8 },
  tabText: { fontSize: 15 },
  spacer: { flex: 1 },
  refresh: { paddingHorizontal: 8, paddingVertical: 6 },
  refreshText: { fontSize: 13 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  statusText: { fontSize: 12, flex: 1, paddingRight: 8 },
  gridWrap: { flex: 1 },
  gridRow: { justifyContent: 'flex-start', marginBottom: 14 },
  cell: { marginRight: GAP },
  cellTitle: { fontSize: 13, marginTop: 6 },
  cellSub: { fontSize: 11, marginTop: 2 },
  cellSrc: { fontSize: 10, marginTop: 1 },
  empty: { fontSize: 12, textAlign: 'center', marginTop: 30, width: '100%' },
})
