import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FlatList, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import Clipboard from '@react-native-clipboard/clipboard'
import Image from '@/components/common/Image'
import {
  MxActionSheet, MxCover, MxEmpty, MxIconButton, MxLoading, MxSegmented, MxSongRow, MxTabBar, MxTopBar,
  type MxActionItem,
} from '@/components/mx'
import { IconPlay, IconSearch, IconMore, IconRefresh } from '@/components/mx/Icons'
import { IconList as IconListMode, IconAlbum as IconGridMode } from '@/components/mx/Icons'
import { useI18n, getMessage } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import {
  GENRE_FILTER_KEY, GENRE_ORDER, GENRE_OTHERS, chipOfGenre, getGenreDict, loadGenreDict, normGenre, parseGenreFilter,
} from '@/core/local/genreDict'
import { useNavActiveId } from '@/store/common/hook'
import { setNavActiveId } from '@/core/common'
import { clearNavIntent, peekNavIntent, setNavIntent } from '@/core/nas/navIntent'
import { useWindowSize } from '@/utils/hooks'
import { playInTempList } from '@/core/nas/playHelper'
import { getNasIndex, restoreNasIndex, isNasReachable } from '@/core/nas/session'
import type { NasSongIndex } from '@/core/nas/nasIndex'
import { ensureLoaded, getCover, getScannedAt, getSongs, type LocalSong } from '@/core/local/dirs'
import { LIST_IDS } from '@/config/constant'
import { addListMusics } from '@/core/list'
import listState from '@/store/list/state'

/* ---------------------------------------------------------------------------
 * 音乐库 = 只读视图：
 *   本机曲目来自「本机曲库」写入的索引，NAS 曲目来自 NAS 索引；
 *   这里不扫描、不增删目录，只负责展示与播放。
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * 列表滚动位置记忆：
 * 进专辑/文件夹后网格会被卸载，退回时重新挂载 —— 默认从顶部开始（用户报的「返回又回到第一条」）。
 * 这里按 listKey 记住偏移量，重新挂载后内容尺寸一就绪就跳回去。
 * ------------------------------------------------------------------------- */
const listOffsets: Record<string, number> = {}

const RestorableList = memo(({ listKey, resetKey, ...rest }: any) => {
  const ref = useRef<FlatList<any>>(null)
  /** 挂载瞬间记住要回到哪里；之后只由「用户拖动/惯性结束」更新，避免挂载时的 0 覆盖记忆 */
  const targetRef = useRef(listOffsets[listKey] ?? 0)
  const curRef = useRef(0)
  const timerRef = useRef<any>(null)
  /** 上一次的筛选标识：切换风格 / 全部·本机·NAS 时列表要回到顶部 */
  const resetRef = useRef<any>(resetKey)
  const mountedRef = useRef(false)

  useEffect(() => {
    const target = targetRef.current
    if (target <= 0) return
    let tries = 0
    // FlatList 一开始只渲染首屏，内容高度不够时 scrollToOffset 会被裁小 —— 所以多试几帧，到位就停
    const tick = () => {
      if (Math.abs(curRef.current - target) < 4 || tries > 12) return
      tries++
      ref.current?.scrollToOffset({ offset: target, animated: false })
      timerRef.current = setTimeout(tick, 60)
    }
    timerRef.current = setTimeout(tick, 40)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  // 筛选条件变了（换风格 / 换来源 / 刷新）：回到顶部并清掉记忆。
  // 停在中间的话，新数据那一段的封面都还没加载，会看到一大片空白。
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    if (resetRef.current === resetKey) return
    resetRef.current = resetKey
    targetRef.current = 0
    curRef.current = 0
    Object.keys(listOffsets).forEach(k => {
      if (k.startsWith(listKey.split(':')[0])) listOffsets[k] = 0
    })
    listOffsets[listKey] = 0
    ref.current?.scrollToOffset({ offset: 0, animated: false })
    // 数据替换后内容高度会变，再补一帧确保真的到顶
    timerRef.current = setTimeout(() => {
      ref.current?.scrollToOffset({ offset: 0, animated: false })
    }, 50)
  }, [resetKey, listKey])

  const remember = (e: any) => { listOffsets[listKey] = e.nativeEvent.contentOffset.y }

  return (
    <FlatList
      ref={ref}
      {...rest}
      // 只渲染视口附近的项。默认 windowSize=21 会把上下各 10 屏都预渲染出来，
      // 上千条的歌曲列表等于同时触发几百个封面请求 —— 切风格后要等十几秒就是这个原因。
      windowSize={5}
      maxToRenderPerBatch={6}
      initialNumToRender={12}
      scrollEventThrottle={16}
      onScroll={(e: any) => { curRef.current = e.nativeEvent.contentOffset.y }}
      onScrollEndDrag={remember}
      onMomentumScrollEnd={remember}
    />
  )
})
RestorableList.displayName = 'RestorableList'

interface Entry {
  key: string
  info: LX.Music.MusicInfoLocal
  ext: string
  origin: 'local' | 'nas'
  album: string
  artist: string
  /** 文件夹分组名 */
  folder: string
  /** 目录路径（文件夹 Tab 显示） */
  folderPath: string
  /** 本机文件路径：按需抽内嵌封面 */
  coverPath?: string
  /** 风格（原始值，未规范化） */
  genre: string
  /** 规范化后的风格（比较用，避免每次筛选都跑一遍正则） */
  genreNorm: string
  /** 是否有封面（本机=扫描时判定；NAS=服务器给的封面地址） */
  hasCover: boolean
}

const fmtDuration = (ms: number): string | undefined => {
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  const total = Math.floor(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const extOf = (path: string) => (/\.([a-z0-9]{2,5})$/i.exec(path)?.[1] ?? '').toLowerCase()

const relDir = (path: string, root: string) => {
  const dir = path.slice(0, Math.max(path.lastIndexOf('/'), 0)) || root
  if (!root) return dir
  const rel = dir.startsWith(root) ? dir.slice(root.length).replace(/^\//, '') : dir
  return rel || root.split('/').filter(Boolean).pop() || root
}

const fromLocal = (song: LocalSong): Entry => ({
  key: song.path,
  ext: extOf(song.path),
  origin: 'local',
  album: song.album || getMessage('lib_unknown_album'),
  artist: song.artist || getMessage('lib_unknown_artist'),
  folder: relDir(song.path, song.dir),
  folderPath: song.path.slice(0, Math.max(song.path.lastIndexOf('/'), 0)),
  coverPath: song.path,
  genre: song.genre ?? '',
  genreNorm: normGenre(song.genre),
  hasCover: !!song.hasCover,
  info: {
    id: `local_${song.path}`,
    name: song.title || song.fileName,
    singer: song.artist,
    source: 'local',
    interval: fmtDuration(song.duration) ?? null,
    meta: {
      songId: song.path,
      albumName: song.album,
      picUrl: null,
      filePath: song.path,
      ext: extOf(song.path),
    },
  },
})

const fromNas = (song: NasSongIndex): Entry => ({
  key: song.id,
  ext: song.ext,
  origin: 'nas',
  album: song.album?.trim() || getMessage('lib_unknown_album'),
  artist: song.artist?.trim() || getMessage('lib_unknown_artist'),
  folder: song.folder?.trim() || getMessage('lib_nas_root'),
  folderPath: song.folder?.trim() || getMessage('lib_nas_root'),
  // 远程曲目的封面：交给 RemoteCover 去取（内嵌封面 → 同目录图），
  // DLNA 的 albumArtURI 很多服务器不给（QNAP 对整轨 wav 就不给），不能只靠它
  coverPath: song.url,
  genre: song.genre ?? '',
  genreNorm: normGenre(song.genre),
  // 以封面扫描产物为准：只有真的生成过缩略图（coverHash 有值）才算有封面
  hasCover: !!song.coverHash,
  info: {
    id: `nas_${song.id}`,
    name: song.title?.trim() || getMessage('lib_untitled'),
    singer: song.artist?.trim() ?? '',
    source: 'local',
    interval: song.interval,
    meta: {
      songId: song.url,
      albumName: song.album?.trim() ?? '',
      picUrl: song.artUrl ?? null,
      filePath: song.url,
      ext: song.ext,
      ...(song.cueStart != null ? { cueStart: song.cueStart, cueEnd: song.cueEnd } : {}),
    },
  },
})

interface Group { key: string, title: string, sub: string, songs: Entry[], path?: string }

const groupBy = (list: Entry[], pick: (e: Entry) => string, sub: (items: Entry[]) => string, pathOf?: (items: Entry[]) => string): Group[] => {
  const map = new Map<string, Entry[]>()
  list.forEach(e => {
    const k = pick(e)
    const arr = map.get(k)
    if (arr) arr.push(e)
    else map.set(k, [e])
  })
  return Array.from(map.entries())
    .map(([key, songs]) => ({
      key,
      title: key,
      sub: sub(songs),
      songs,
      path: pathOf?.(songs),
    }))
    .sort((a, b) => a.key.localeCompare(b.key, 'zh-Hans-CN'))
}

const TABS: { key: string, labelKey: 'lib_tab_song' | 'lib_tab_album' | 'lib_tab_artist' | 'lib_tab_folder' }[] = [
  { key: 'songs', labelKey: 'lib_tab_song' },
  { key: 'albums', labelKey: 'lib_tab_album' },
  { key: 'artists', labelKey: 'lib_tab_artist' },
  { key: 'folders', labelKey: 'lib_tab_folder' },
]

/** 歌曲 tab 里 NAS 曲目的抽样上限：上万首全量渲染会卡，只铺 1000 首 */
const SONGS_LIMIT = 1000

/** 按种子稳定打乱：同一种子结果一致，滚动时列表不会跳 */
const shuffleBySeed = <T,>(arr: T[], seed: number): T[] => {
  if (arr.length <= 1) return arr.slice()
  const a = arr.slice()
  let s = ((seed * 9301 + 49297) % 233280) || 1
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280
    const j = Math.floor((s / 233280) * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

const GAP = 10

const SOURCES: { key: string, labelKey?: 'lib_scope_all' | 'lib_scope_local' }[] = [
  { key: 'all', labelKey: 'lib_scope_all' },
  { key: 'local', labelKey: 'lib_scope_local' },
  { key: 'nas' },
]

/* 模块级缓存：切页面再回来先秒显上一次的列表，再后台核对是否需要重建 */
let entriesCache: Entry[] | null = null
let cacheSignature = ''
let cacheStatus = ''
/** 歌曲抽样种子：模块级保存 —— 切菜单/重进页面保持上次刷新那批，只有点「刷新」才换 */
let songsSeedModule = 0

const Library = () => {
  const t = useI18n()
  const [nasOffline, setNasOffline] = useState(false)
  const [nasCount, setNasCount] = useState(0)
  const tabs = useMemo(() => TABS.map(x => ({ key: x.key, label: t(x.labelKey) })), [t])
  const sources = useMemo(() => SOURCES.map(x => ({
    key: x.key,
    label: x.labelKey ? t(x.labelKey) : 'NAS',
    disabled: x.key == 'nas' && !nasCount,
  })), [t, nasCount])
  const navActiveId = useNavActiveId()
  const { width } = useWindowSize()
  const wide = width >= 700
  // 与「随机 / 最近」同口径：每格约 150dp，手机 3 列，平板 4–8 列
  const [listWidth, setListWidth] = useState(0)
  const columns = useMemo(() => {
    const w = listWidth || width
    return Math.max(w < 600 ? 3 : 4, Math.min(8, Math.round(w / 150)))
  }, [listWidth, width])
  const cellW = useMemo(() => {
    const w = listWidth || width
    return Math.max(72, Math.floor((w - 32 - GAP * (columns - 1)) / columns))
  }, [listWidth, width, columns])
  const active = navActiveId == 'nav_local'

  const [tab, setTab] = useState('songs')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [source, setSource] = useState('all')
  const [entries, setEntries] = useState<Entry[]>(() => entriesCache ?? [])
  const [loading, setLoading] = useState(entriesCache == null)
  const [status, setStatus] = useState(cacheStatus)
  const [drill, setDrill] = useState<Group | null>(null)
  /** 风格筛选（多选，默认只剩 Pop）：先在本地生效，再防抖落盘，避免每次点击都走全局设置→整树重渲染 */
  const genreFilterRaw = useSettingValue(GENRE_FILTER_KEY)
  const [genreLocal, setGenreLocal] = useState<string[] | null>(null)
  const selectedGenres = useMemo(
    // 归一化到 chips 标签：旧的 "pop" → "Pop"，不在固定列表里的旧值 → "others"
    () => (genreLocal ?? parseGenreFilter(genreFilterRaw)).map(g => (g ? chipOfGenre(g) : g)),
    [genreLocal, genreFilterRaw],
  )
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [genreDict, setGenreDict] = useState<string[]>(getGenreDict)
  /** 歌曲 tab 抽样的种子（模块级持久）：只有点「刷新」才换，切菜单回来保持上次那批 */
  const [songsSeed, setSongsSeed] = useState(songsSeedModule)
  /** 刷新进行中：用来防连点，并让图标/文字有明确反馈 */
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)
  /** 「打开所在文件夹」待定位的文件夹：目录名 + 绝对路径（路径优先，同名目录才不会串） */
  const pendingFolder = useRef<{ name: string, path: string } | null>(null)
  const [sheetFor, setSheetFor] = useState<Entry | null>(null)
  const [listSheet, setListSheet] = useState<Entry | null>(null)
  /** 临时提示（正在刷新…/已刷新 · 时间）：1.8 秒后自动消失，不覆盖计数文案 */
  const [flash, setFlash] = useState('')
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showFlash = useCallback((msg: string, ms: number) => {
    setFlash(msg)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => { setFlash('') }, ms)
  }, [])
  /** 当前 NAS 可达状态（供刷新时「沿用」而不是重新探测） */
  const nasOfflineRef = useRef(false)
  const restoredRef = useRef(false)
  const nasSongsRef = useRef<NasSongIndex[]>([])

  const reload = useCallback(async(probe: 'force' | 'keep' = 'force') => {
    await ensureLoaded()
    const localSongs = getSongs()
    const local = localSongs.map(fromLocal)

    // 1) 首次进入（没有缓存）时先把本机条目渲染出来，不等 NAS 探测；
    //    有缓存时不要这样做 —— 否则每次刷新都会先闪成「只有本机」再恢复
    if (!entriesCache) {
      setEntries(local)
      setLoading(false)
    }

    // 2) 判断 NAS 是否在同一局域网（结果本身缓存 30 秒，切 tab 不会反复探测）
    // 进音乐库时强制真探测一次：之前播放失败会把 NAS 标记成不可达（缓存 30s），
    // 用缓存会导致「NAS 明明在线，音乐库里却看不到 NAS 的歌」
    // 刷新时沿用当前可达状态：不重新探测（探测抖动会把整块 NAS 曲目判掉线）
    const reachable = probe == 'keep' ? !nasOfflineRef.current : await isNasReachable(true)
    nasOfflineRef.current = !reachable
    setNasOffline(!reachable)

    let nasIndex: Awaited<ReturnType<typeof restoreNasIndex>> | null = null
    // 与「最近随机」同一口径：探测不通（出门在外）就把 NAS 曲目整块排除，
    // 只留本机，避免随机/列表里全是放不出来的歌
    if (reachable) nasIndex = getNasIndex() ? getNasIndex() : await restoreNasIndex()
    nasSongsRef.current = nasIndex?.songs ?? []
    setNasCount(nasSongsRef.current.length)

    // 签名带上 NAS 索引 builtAt 与可达状态：任一变化都要重算
    const signature = `${localSongs.length}|${getScannedAt()}|${nasIndex?.builtAt ?? 0}|${nasSongsRef.current.length}|${reachable ? 1 : 0}`
    if (entriesCache && signature == cacheSignature) {
      // 上面为了「不等 NAS 先出本机」已经把列表设成本机那几条，
      // 这里命中缓存就直接 return 的话，NAS 曲目会一直不回列表（刷新后「NAS 全没了」就是这个）
      setEntries(entriesCache)
      setStatus(cacheStatus || '')
      setLoading(false)
      return
    }
    const nas = nasSongsRef.current.map(fromNas)
    const next = [...local, ...nas]
    const st = !reachable
      ? t('lib_nas_offline', { local: local.length })
      : !(local.length || nas.length)
        ? ''
        : nas.length
          ? t('lib_scope_summary', { local: local.length, nas: nas.length })
          : t('lib_nas_no_index', { local: local.length })
    entriesCache = next
    cacheSignature = signature
    cacheStatus = st
    setEntries(next)
    setStatus(st)
    setLoading(false)
  }, [t])

  // 每次进入本页都重读（NAS 索引可能在别处刚建好）；不换抽样批次 —— 保持上次「刷新」的那批
  useEffect(() => {
    if (!active) return
    void reload()
  }, [active, reload])

  // 索引由「本机曲库」/「NAS 曲库」写入：扫描完成、删目录、NAS 建索引后这里自动刷新
  useEffect(() => {
    const handleUpdated = () => { void reload() }
    global.state_event.on('mxLocalIndexUpdated', handleUpdated)
    global.state_event.on('mxNasIndexUpdated', handleUpdated)
    return () => {
      global.state_event.off('mxLocalIndexUpdated', handleUpdated)
      global.state_event.off('mxNasIndexUpdated', handleUpdated)
    }
  }, [reload])

  const filtered = useMemo(() => {
    if (source == 'local') return entries.filter(e => e.origin == 'local')
    if (source == 'nas') return entries.filter(e => e.origin == 'nas')
    return entries
  }, [entries, source])

  // 歌曲 tab：NAS 上万首一次性铺开会卡顿，只随机抽 1000 首；本机曲目全保留。
  // 「全部」来源时整张表一起打乱（本机不再固定排在最前，否则刷新看不出变化）。
  // 种子只在「进页面 / 点刷新」时变化，滚动时抽样结果保持稳定，不会跳。
  //
  // 性能：按风格预先分桶（只在 entries 变化时扫一遍 1.2 万条），
  // 之后切换风格只是从桶里取数组，不需要每次点击都全量过滤 —— 否则点一下卡一下。
  const genreBuckets = useMemo(() => {
    const localAll: Entry[] = []
    const nasAll: Entry[] = []
    const local = new Map<string, Entry[]>()
    const nas = new Map<string, Entry[]>()
    for (const e of filtered) {
      // 注：这里不再要求「有封面」才进列表。封面现在是惰性加载，
      // 重建索引后 coverHash 全为空，硬过滤会导致整个曲库看不见。
      const isNas = e.origin == 'nas'
      if (isNas) nasAll.push(e) ; else localAll.push(e)
      const m = isNas ? nas : local
      const key = chipOfGenre(e.genreNorm)        // 分桶键：固定 chip（Pop / … / others）
      const arr = m.get(key)
      if (arr) arr.push(e)
      else m.set(key, [e])
    }
    return { localAll, nasAll, local, nas }
  }, [filtered])

  const songsView = useMemo(() => {
    if (tab != 'songs') return filtered
    const { localAll, nasAll, local, nas } = genreBuckets
    let localList = localAll
    let nasList = nasAll
    if (selectedGenres.length) {
      localList = []
      nasList = []
      for (const g of selectedGenres) {
        const a = local.get(g)
        if (a) localList = localList.concat(a)
        const b = nas.get(g)
        if (b) nasList = nasList.concat(b)
      }
    }
    // 有封面的排前面、没封面的沉底；两组各自按种子打乱，刷新才看得出变化
    const all = [...localList, ...nasList]
    const withCover = all.filter(e => e.hasCover)
    const rest = all.filter(e => !e.hasCover)
    return [
      ...shuffleBySeed(withCover, songsSeed),
      ...shuffleBySeed(rest, songsSeed + 7919),
    ].slice(0, SONGS_LIMIT)
  }, [filtered, tab, songsSeed, selectedGenres, genreBuckets, source])
  const nasTotal = useMemo(() => {
    if (!selectedGenres.length) return genreBuckets.nasAll.length
    let n = 0
    for (const g of selectedGenres) n += genreBuckets.nas.get(g)?.length ?? 0
    return n
  }, [genreBuckets, selectedGenres])

  // 风格 chips：固定顺序（全部 → Pop → Classical → HIFI TEST → New Age → story → others）
  // others 只在字典里确实存在「不属于前 5 类」的风格时出现，避免点进去空列表
  const genreChips = useMemo(() => {
    const list: string[] = ['', ...GENRE_ORDER]
    if (genreDict.some(g => chipOfGenre(g) === GENRE_OTHERS)) list.push(GENRE_OTHERS)
    return list
  }, [genreDict])
  const toggleGenre = useCallback((g: string) => {
    let next: string[]
    if (!g) next = []
    else {
      const set = new Set(selectedGenres)
      if (set.has(g)) set.delete(g)
      else set.add(g)
      next = [...set]
    }
    // 先本地生效（点击即时响应），再把落盘推后 400ms
    setGenreLocal(next)
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      updateSetting({ [GENRE_FILTER_KEY]: JSON.stringify(next) } as any)
    }, 400)
  }, [selectedGenres])

  // 首屏封面预热：切风格后列表是新的，NAS 封面要走一次网络 Range 读，
  // 这里按顺序先把前 24 个排队读出来，滚动到时基本已经就绪（getCover 自带缓存）
  useEffect(() => {
    if (tab != 'songs' || !songsView.length) return
    let alive = true
    void (async() => {
      for (const e of songsView.slice(0, 8)) {
        if (!alive) return
        if (!e.coverPath) continue
        await getCover(e.coverPath).catch(() => null)
      }
    })()
    return () => { alive = false }
  }, [songsView, tab])

  // 字典可能在别处（本机/NAS 扫描完成）更新，订阅事件刷新 chips
  useEffect(() => {
    const sync = () => { setGenreDict([...getGenreDict()]) }
    global.state_event.on('mxGenreDictUpdated', sync)
    void loadGenreDict().then(sync)
    return () => { global.state_event.off('mxGenreDictUpdated', sync) }
  }, [])

  const groups = useMemo(() => {
    if (tab == 'albums') return groupBy(filtered, e => e.album, s => `${s[0].artist} · ${s.length} 首`)
    if (tab == 'artists') return groupBy(filtered, e => e.artist, s => `${s.length} 首`)
    if (tab == 'folders') return groupBy(filtered, e => e.folder, s => `${s.length} 首`, s => s[0].folderPath)
    return []
  }, [filtered, tab])

  const playEntry = useCallback((list: Entry[], target: Entry) => {
    void playInTempList(list.map(e => e.info), target.info.id)
  }, [])

  const addToLove = useCallback((entry: Entry) => {
    void addListMusics(LIST_IDS.LOVE, [entry.info], 'top')
    setStatus(t('lib_loved', { name: entry.info.name }))
  }, [])

  const addToList = useCallback((entry: Entry, listId: string, name: string) => {
    void addListMusics(listId, [entry.info], 'bottom')
    setStatus(t('lib_added_to', { list: name, name: entry.info.name }))
  }, [])

  // 「打开所在文件夹」：切到对应来源 + 文件夹 tab，然后自动进入那个目录
  const takeNavIntent = useCallback(() => {
    const intent = peekNavIntent()
    if (intent?.view !== 'local') return
    const name = String(intent.folder || intent.album || '').trim()
    const dirPath = String(intent.dirPath || '').trim()
    const lastSeg = dirPath.split('/').filter(Boolean).slice(-1)[0] ?? ''
    if (!name && !dirPath) return
    clearNavIntent()
    setSource(intent.origin === 'nas' ? 'nas' : intent.origin === 'local' ? 'local' : 'all')
    setDrill(null)
    setTab('folders')
    pendingFolder.current = { name: name || lastSeg, path: dirPath }
  }, [])

  // 进入本页时消费一次
  useEffect(() => {
    if (!active) return
    takeNavIntent()
  }, [active, takeNavIntent])

  // 已经在音乐库里点「打开所在文件夹」时 nav 不变，靠事件直达
  useEffect(() => {
    const onIntent = () => { takeNavIntent() }
    global.state_event.on('mxNavIntent', onIntent)
    return () => { global.state_event.off('mxNavIntent', onIntent) }
  }, [takeNavIntent])

  // 分组算出来后自动打开那个文件夹
  // 本机：直接按「文件完整路径」筛出该目录下的歌，构造 drill（不依赖分组字段，最可靠）
  // NAS：filePath 是 DLNA 地址，改用目录标题匹配
  useEffect(() => {
    const want = pendingFolder.current
    if (!want || tab != 'folders' || !groups.length) return
    const norm = (v: string) => v.toLowerCase().replace(/[\s\-_().（）《》【】]/g, '')
    const normPath = (v: string) => String(v ?? '').replace(/\u005c/g, '/').replace(/\/+$/, '')
    const wantPath = normPath(want.path)

    if (wantPath) {
      const inDir = filtered.filter(e => {
        const fp = normPath(String((e.info?.meta as any)?.filePath ?? e.coverPath ?? ''))
        return fp.startsWith(wantPath + '/')
      })
      if (inDir.length) {
        pendingFolder.current = null
        setDrill({
          key: wantPath,
          title: inDir[0].folder || want.name || wantPath.split('/').filter(Boolean).slice(-1)[0] || '',
          sub: `${inDir.length} 首`,
          songs: inDir,
          path: wantPath,
        })
        return
      }
    }

    let g = groups.find(x => norm(x.title) == norm(want.name))
    if (!g) g = groups.find(x => norm(x.title).includes(norm(want.name)) || norm(want.name).includes(norm(x.title)))
    if (!g) return
    pendingFolder.current = null
    setDrill(g)
  }, [groups, tab, filtered])

  const openInFolder = useCallback((entry: Entry) => {
    const isNas = entry.origin === 'nas'
    // NAS：目录标题 → 由索引回溯成面包屑；本机：专辑名 → Local 页按专辑过滤
    const dir = isNas ? (entry.folder || '') : (entry.album || '')
    const path = isNas ? (entry.folderPath || dir) : (entry.info.meta.filePath || entry.coverPath || '')
    if (!dir && !path) {
      setStatus(t('lib_no_path'))
      return
    }
    setSheetFor(null)
    const filePath = String(entry.info?.meta?.filePath ?? entry.coverPath ?? '')
    const dirPath = !isNas && filePath ? filePath.slice(0, Math.max(filePath.lastIndexOf('/'), 0)) : ''
    // 本机和 NAS 一样：都回到「音乐库 → 文件夹」并打开那个目录
    const target = dir
    if (target || dirPath) {
      setNavIntent({ view: 'local', album: target, folder: target, dirPath, origin: isNas ? 'nas' : 'local' })
      setStatus(t('lib_jump_folder', { path: target || dirPath }))
      setNavActiveId('nav_local')
    } else if (path) {
      try { Clipboard.setString(path) } catch {}
      setStatus(t('lib_path_copied', { path }))
    } else {
      setStatus(t('lib_no_path'))
    }
  }, [t])

  const sheetItems: MxActionItem[] = sheetFor
    ? [
        {
          key: 'play',
          label: t('lib_play'),
          onPress: () => {
            const pool = tab == 'songs' ? songsView : (drill?.songs ?? filtered)
            playEntry(pool.length ? pool : [sheetFor], sheetFor)
          },
        },
        { key: 'folder', label: t('lib_open_folder'), onPress: () => { openInFolder(sheetFor) } },
        { key: 'love', label: t('lib_add_love'), onPress: () => { addToLove(sheetFor) } },
        { key: 'list', label: t('lib_add_playlist'), onPress: () => { setListSheet(sheetFor) } },
      ]
    : []

  const listSheetItems: MxActionItem[] = listSheet
    ? listState.userList.length
      ? listState.userList.map(l => ({
          key: l.id,
          label: l.name,
          onPress: () => { addToList(listSheet, l.id, l.name) },
        }))
      : [{ key: 'empty', label: '还没有播放列表（去「我的最爱」新建）', onPress: () => {} }]
    : []

  // 「歌曲」页抽样提示：NAS 曲目超过上限时才说明，否则会被误读成「曲库少了歌」
  const sampleNote = tab == 'songs' && nasTotal > SONGS_LIMIT
    ? t('lib_songs_sample', { total: nasTotal, n: SONGS_LIMIT })
    : ''
  const subtitleText = drill ? drill.sub : ([flash || status, sampleNote].filter(Boolean).join(' · ') || undefined)

  /**
   * 刷新：立刻换一批抽样 + 后台重读索引。
   * NAS 曲目少于抽样上限时，列表内容本来就不会变，所以必须有明确反馈，
   * 否则用户点了只会觉得「没反应」——文字至少显示 700ms，结束后给出刷新时刻。
   */
  const doRefresh = useCallback(async() => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    showFlash(t('lib_refreshing'), 60000)
    songsSeedModule += 1
    setSongsSeed(songsSeedModule)
    const t0 = Date.now()
    try {
      await reload('keep')
    } catch {}
    const left = 700 - (Date.now() - t0)
    if (left > 0) await new Promise<void>(resolve => { setTimeout(resolve, left) })
    refreshingRef.current = false
    setRefreshing(false)
    const d = new Date()
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    showFlash(t('lib_refreshed_at', { time: hhmm }), 1800)
  }, [reload, t, showFlash])

  const header = (
    <MxTopBar
      title={drill ? drill.title : t('nav_library')}
      subtitle={subtitleText}
      left={drill ? 'back' : (wide ? 'none' : 'menu')}
      onLeftPress={() => {
        if (drill) {
          setDrill(null)
          return
        }
        global.app_event.changeMenuVisible(true)
      }}
      actions={[{
        key: 'refresh',
        node: <MxIconButton onPress={() => { void doRefresh() }}>
          <IconRefresh size={18} color={refreshing ? MX.color.accent : MX.color.text} />
        </MxIconButton>,
      }, {
        key: 'mode',
        node: <MxIconButton onPress={() => { setViewMode(m => m === 'grid' ? 'list' : 'grid') }}>
          {viewMode === 'grid' ? <IconListMode size={18} color={MX.color.text} /> : <IconGridMode size={18} color={MX.color.text} />}
        </MxIconButton>,
      }, {
        key: 'search',
        node: <MxIconButton onPress={() => { setNavActiveId('nav_search') }}><IconSearch size={18} color={MX.color.text} /></MxIconButton>,
      }]}
    />
  )

  const songRow = (list: Entry[]) => ({ item }: { item: Entry }) => (
    <MxSongRow
      art={item.info.meta.picUrl}
      coverPath={item.coverPath}
      title={item.info.name}
      sub={[item.info.singer, item.info.meta.albumName].filter(Boolean).join(' · ') || undefined}
      badge={(item.ext || '').toUpperCase() || (item.origin == 'nas' ? 'NAS' : t('lib_badge_local'))}
      badgeTone={item.origin == 'nas' ? 'accent' : 'plain'}
      duration={item.info.interval ?? undefined}
      onPress={() => { playEntry(list, item) }}
      onMore={() => { setSheetFor(item) }}
    />
  )

  const songCard = (list: Entry[]) => ({ item }: { item: Entry }) => (
    <TouchableOpacity style={{ width: cellW, marginBottom: 14 }} activeOpacity={0.75} onPress={() => { playEntry(list, item) }}>
      <View style={{ width: cellW, height: cellW }}>
        <MxCover art={item.info.meta.picUrl} path={item.coverPath} size={cellW} radius={8} />
        <TouchableOpacity onPress={() => { setSheetFor(item) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ position: 'absolute', right: 6, top: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <IconMore size={14} color="#fff" />
        </TouchableOpacity>
      </View>
      <Text size={13} color={MX.color.text} numberOfLines={1} style={{ marginTop: 6 }}>{item.info.name}</Text>
      <Text size={11} color={MX.color.text3} numberOfLines={1} style={{ marginTop: 2 }}>
        {[item.info.singer, item.info.meta.albumName].filter(Boolean).join(' · ') || t('lib_unknown_album')}
      </Text>
      <Text size={10} color={item.origin == 'nas' ? MX.color.accent : MX.color.text4} numberOfLines={1} style={{ marginTop: 1 }}>
        {item.origin == 'nas' ? 'NAS' : t('lib_badge_local')}
      </Text>
    </TouchableOpacity>
  )

  let body: ReactNode
  if (loading) {
    body = <MxLoading text={t('lib_loading')} />
  } else if (drill) {
    body = (
      <RestorableList
        listKey={`drill:${tab}:${drill.key}`}
        resetKey={drill.key}
        data={drill.songs}
        keyExtractor={(e: Entry) => e.key}
        renderItem={songRow(drill.songs)}
        ListHeaderComponent={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: MX.space.page, paddingVertical: 10 }}>
            <TouchableOpacity onPress={() => { playEntry(drill.songs, drill.songs[0]) }} activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: MX.color.accentDim, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
              <IconPlay size={14} color={MX.color.accent} />
              <Text size={12} color={MX.color.accent}>{t('lib_play_all')}</Text>
            </TouchableOpacity>
            {drill.path ? <Text size={10.5} color={MX.color.text4} numberOfLines={1} style={{ flex: 1 }}>{drill.path}</Text> : null}
          </View>
        }
      />
    )
  } else if (tab == 'songs') {
    body = songsView.length
      ? <RestorableList
          key={`songs-${viewMode}-${columns}`}
          listKey={`songs:${source}:${viewMode}:${columns}`}
          resetKey={`${source}:${selectedGenres.join('/')}:${songsSeed}`}
          data={songsView}
          keyExtractor={(e: Entry) => e.key}
          numColumns={viewMode === 'grid' ? columns : 1}
          columnWrapperStyle={viewMode === 'grid' ? { gap: 10, paddingHorizontal: 16 } : undefined}
          contentContainerStyle={viewMode === 'grid' ? { paddingTop: 12, paddingBottom: 16 } : undefined}
          renderItem={viewMode === 'grid' ? songCard(songsView) : songRow(songsView)}
        />
      : (
          <MxEmpty
            text={entries.length ? t('lib_empty_cat') : t('lib_empty_lib')}
            action={
              <TouchableOpacity onPress={() => { setNavActiveId('nav_dirs') }} activeOpacity={0.8}>
                <View style={{ borderWidth: 1, borderColor: MX.color.accent, backgroundColor: MX.color.accentDim, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 }}>
                  <Text size={12.5} color={MX.color.accent}>{t('lib_go_local')}</Text>
                </View>
              </TouchableOpacity>
            }
          />
        )
  } else {
    // 专辑 / 艺人 / 文件夹：默认也走大图网格（文件夹没有封面图，保持列表）
    const canGrid = viewMode === 'grid' && tab !== 'folders'
    body = groups.length
      ? (
          <RestorableList
            key={`groups-${tab}-${viewMode}-${columns}`}
            listKey={`groups:${tab}:${source}:${viewMode}:${columns}`}
            resetKey={`${tab}:${source}:${selectedGenres.join('/')}`}
            data={groups}
            keyExtractor={(g: any) => g.key}
            numColumns={canGrid ? columns : 1}
            columnWrapperStyle={canGrid ? { gap: 10, paddingHorizontal: 16 } : undefined}
            contentContainerStyle={canGrid ? { paddingTop: 12, paddingBottom: 16 } : undefined}
            renderItem={({ item }: { item: Group }) => canGrid
              ? (
                  <TouchableOpacity style={{ width: cellW, marginBottom: 14 }} activeOpacity={0.75} onPress={() => { setDrill(item) }}>
                    <View style={{ width: cellW, height: cellW }}>
                      <MxCover
                        art={item.songs[0]?.info.meta.picUrl ?? null}
                        path={item.songs[0]?.coverPath}
                        size={cellW}
                        radius={tab == 'artists' ? cellW / 2 : 8}
                      />
                      <TouchableOpacity onPress={() => { setSheetFor(item.songs[0]) }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ position: 'absolute', right: 6, top: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
                        <IconMore size={14} color="#fff" />
                      </TouchableOpacity>
                    </View>
                    <Text size={12.5} color={MX.color.text} numberOfLines={1} style={{ marginTop: 6 }}>{item.title}</Text>
                    <Text size={11} color={MX.color.text3} numberOfLines={1} style={{ marginTop: 1 }}>{item.sub}</Text>
                  </TouchableOpacity>
                )
              : (
                  <MxSongRow
                    art={item.songs[0]?.info.meta.picUrl ?? null}
                    coverPath={item.songs[0]?.coverPath}
                    title={item.title}
                    sub={tab == 'folders' && item.path ? `${item.path} · ${item.sub}` : item.sub}
                    onPress={() => { setDrill(item) }}
                    onMore={() => { setSheetFor(item.songs[0]) }}
                    right={
                      <TouchableOpacity onPress={() => { playEntry(item.songs, item.songs[0]) }} activeOpacity={0.6}
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
                        <IconPlay size={15} color={MX.color.text3} />
                      </TouchableOpacity>
                    }
                  />
                )}
          />
        )
      : <MxEmpty text={t('lib_empty_cat')} />
  }

  return (
    <View style={{ flex: 1, backgroundColor: MX.color.app }}>
      {header}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        {drill ? null : <View style={{ flex: 1 }}><MxTabBar tabs={tabs} activeKey={tab} onChange={k => { setTab(k) }} /></View>}
        {wide
          ? (
              <View style={{ paddingRight: MX.space.page, paddingBottom: 7 }}>
                <MxSegmented items={sources} activeKey={source} onChange={k => { setSource(k) }} />
              </View>
            )
          : null}
      </View>
      {!wide && !drill
        ? (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: MX.space.page, paddingTop: 7 }}>
              <MxSegmented items={sources} activeKey={source} onChange={k => { setSource(k) }} />
            </View>
          )
        : null}

      {!drill && tab == 'songs'
        ? (
            <FlatList
              horizontal
              data={genreChips}
              keyExtractor={g => g || '__all__'}
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, marginTop: 8 }}
              contentContainerStyle={{ paddingHorizontal: MX.space.page, gap: 8 }}
              renderItem={({ item }) => {
                const on = item ? selectedGenres.includes(item) : !selectedGenres.length
                return (
                  <TouchableOpacity
                    onPress={() => { toggleGenre(item) }}
                    activeOpacity={0.75}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 999,
                      borderWidth: 1,
                      backgroundColor: on ? MX.color.accentDim : 'transparent',
                      borderColor: on ? MX.color.accent : MX.color.line,
                    }}
                  >
                    <Text size={12} color={on ? MX.color.accent : MX.color.text3}>
                      {item || t('lib_genre_all')}
                    </Text>
                  </TouchableOpacity>
                )
              }}
            />
          )
        : null}

      <View style={{ flex: 1 }} onLayout={e => { setListWidth(e.nativeEvent.layout.width) }}>{body}</View>

      <MxActionSheet
        visible={!!sheetFor}
        title={sheetFor?.info.name}
        items={sheetItems}
        onClose={() => { setSheetFor(null) }}
      />
      <MxActionSheet
        visible={!!listSheet}
        title={`加入播放列表：${listSheet?.info.name ?? ''}`}
        items={listSheetItems}
        onClose={() => { setListSheet(null) }}
      />
    </View>
  )
}

export default Library
