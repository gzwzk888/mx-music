import { useCallback, useEffect, useMemo, useState, useRef} from 'react'
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useWindowSize } from '@/utils/hooks'
import { useTheme } from '@/store/theme/hook'
import { useNavActiveId } from '@/store/common/hook'
import { createStyle } from '@/utils/tools'
import { applyCueRanges, browse, connectDevice, toMusicInfo, type NasDevice, type NasItem } from '@/core/nas/dlna'
import { applyCueTracks, parseCue } from '@/core/nas/cue'
import { buildCueIndex, findCueForAlbum, loadCueIndex } from '@/core/nas/cueIndex'
import { setCueRange } from '@/core/nas/cueRanges'
import { isSmbVerified, loadSmbVerified, markSmbVerified, clearSmbVerified } from '@/core/nas/smbSession'
import { loadSmbCreds, saveSmbCreds, clearSmbCreds, smbProbe, smbList, smbReadText, hasSmb, resetSmbCache, type SmbCreds } from '@/utils/nativeModules/smb'
import { discoverDlnaServers } from '@/utils/nativeModules/mediaScan'
import { addListMusics, clearListMusics, createUserList, removeUserList } from '@/core/list'
import { playListById } from '@/core/player/player'
import listState from '@/store/list/state'
import { getData, saveData } from '@/plugins/storage'
import { getNasIndex, getPlaylistsSync, markPlaylistsSynced, patchNasSession, persistNasSession, restoreNasIndex, restoreNasSession, setNasIndex } from '@/core/nas/session'
import { buildNasIndex, findFolderByTitle } from '@/core/nas/nasIndex'
import { clearNavIntent, peekNavIntent } from '@/core/nas/navIntent'
import { loadNasPlaylistsDetailed } from '@/core/nas/nasPlaylists'
import { playInTempList } from '@/core/nas/playHelper'
import { setCurrentTime } from '@/plugins/player'

const NAS_HOST_KEY = '@nas_host'

const NAS_LIST_NAME = 'NAS 音乐'   // 旧的合并列表名，仅用于清理
const NAS_LIST_PREFIX = 'NAS·'   // 旧命名前缀（仅用于清理）
const NAS_ID_PREFIX = 'userlist_nas_'
const NAS_TEMP_LIST = 'NAS·当前目录'
// 首次进入不预填地址：由「自动发现」或用户输入决定
const PAGE_SIZE = 300
/** ExoPlayer 能直接播的格式；dsf/dff(DSD)、ape 暂不支持，导入时跳过 */
const SUPPORTED_EXT = new Set(['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'alac', 'mka', 'aiff'])

interface Crumb { id: string, title: string }

export default () => {
  const theme = useTheme()
  const { width: winWidth } = useWindowSize()
  const isNarrow = winWidth < 620
  const [host, setHost] = useState('')
  const [device, setDevice] = useState<NasDevice | null>(null)
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: '0', title: '根目录' }])
  const [items, setItems] = useState<NasItem[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('点「自动发现」搜索局域网内的音乐服务器，或手动输入地址')
  const [loading, setLoading] = useState(false)
  const [servers, setServers] = useState<Array<{ name: string, host: string }>>([])
  const [indexing, setIndexing] = useState(false)
  const [indexMsg, setIndexMsg] = useState('')
  const [smbUser, setSmbUser] = useState('')
  const [smbPass, setSmbPass] = useState('')
  const [smbShare, setSmbShare] = useState('Multimedia')
  const [smbSaved, setSmbSaved] = useState(false)
  const [smbVerifying, setSmbVerifying] = useState(false)
  const [smbOpen, setSmbOpen] = useState(false)
  // 安全门槛：每次启动都需要重新验证 SMB 才能浏览目录
  // 验证态存模块级（切菜单会卸载本页，useState 会丢），进程重启才清零
  const [smbVerified, setSmbVerifiedState] = useState(isSmbVerified)
  const [indexInfo, setIndexInfo] = useState('')
  const [cueInfo, setCueInfo] = useState('')
  const indexAbortRef = useRef(false)

  // 恢复上次的 NAS 会话（菜单切换 / 重启 App 后都能接上）
  const navActiveId = useNavActiveId()
  const active = navActiveId == 'nav_nas'
  const restoredRef = useRef(false)

  useEffect(() => {
    if (!active || restoredRef.current) return
    restoredRef.current = true
    void restoreNasSession().then(async session => {
      if (session.host && session.device) setHost(session.host)
      if (session.device && session.items.length && !smbVerified) {
        setStatus('已恢复上次连接，验证 SMB 账号后显示目录')
      }
      if (session.device && session.items.length && smbVerified) {
        setDevice(session.device)
        setCrumbs(session.crumbs.length ? session.crumbs : [{ id: '0', title: '根目录' }])
        setItems(session.items)
        setTotal(session.total)
        const last = session.crumbs[session.crumbs.length - 1]
        setStatus(`已恢复上次位置：${last?.title ?? '根目录'}（${session.items.length} 项）`)
      } else if (session.host) {
        setStatus(`上次连接的服务器：${session.host}，点「连接」继续`)
      }

      // 歌单点专辑 → 跳到对应 NAS 目录
      const intent = peekNavIntent()
      if (intent?.view == 'nas' && intent.album) {
        clearNavIntent()
        const idx = await restoreNasIndex()
        const folder = idx ? findFolderByTitle(idx.folders, intent.album) : null
        if (session.device && folder) {
          const stack: Crumb[] = [{ id: '0', title: '根目录' }, { id: folder.id, title: folder.title }]
          setCrumbs(stack)
          setDevice(session.device)
          await loadDir(session.device, stack)
        } else if (session.device) {
          setStatus(`NAS 目录里没找到专辑「${intent.album}」，点「连接」后可重建索引`)
        }
      }
    }).catch(() => {})
  }, [])

  const audioItems = useMemo(
    () => items.filter(i => !i.isContainer && i.url && SUPPORTED_EXT.has(i.ext)),
    [items],
  )
  const unsupportedCount = useMemo(
    () => items.filter(i => !i.isContainer && i.url && !SUPPORTED_EXT.has(i.ext)).length,
    [items],
  )
  const hasMore = items.length > 0 && total > items.length

  const buildIndex = useCallback(async(dev: NasDevice) => {
    setIndexing(true)
    setIndexMsg('正在建立索引…')
    try {
      indexAbortRef.current = false
      const idx = await buildNasIndex(dev, msg => { setIndexMsg(msg) }, () => indexAbortRef.current)
      setNasIndex(idx)
      setIndexMsg('')
      setIndexInfo(`索引：${idx.songs.length} 首 / ${idx.folders.length} 个目录`)
      setStatus(`索引完成：${idx.songs.length} 首，${idx.folders.length} 个目录（可全盘搜索）`)
    } catch (e: any) {
      setIndexMsg('')
      setStatus(`索引失败：${e?.message ?? e}`)
    } finally {
      setIndexing(false)
    }
  }, [])

  // 独立的 CUE 扫描（很慢：SMB 每个目录一次往返，所以不放进重建索引里）
  const scanCue = useCallback(async() => {
    if (indexing) return
    const creds = await loadSmbCreds()
    if (!creds?.user) {
      setStatus('先配置并通过 SMB 验证，再扫描 CUE')
      setSmbOpen(true)
      return
    }
    setIndexing(true)
    indexAbortRef.current = false
    try {
      setIndexMsg('正在扫描 CUE…')
      const entries = await buildCueIndex(creds, msg => { setIndexMsg(msg) }, () => indexAbortRef.current)
      setStatus(`CUE 扫描完成：${entries.length} 个目录里有 .cue`)
    } catch (e: any) {
      setStatus(`CUE 扫描失败：${e?.message ?? e}`)
    } finally {
      setIndexMsg('')
      setIndexing(false)
    }
  }, [indexing])

  // 不再自动扫描：只在已有索引时显示数量；没有索引就提示用户手动建
  const ensureIndex = useCallback(async(_dev: NasDevice) => {
    const mem = getNasIndex()
    if (mem?.songs?.length) {
      setIndexInfo(`索引：${mem.songs.length} 首 / ${mem.folders.length} 个目录`)
      return
    }
    const disk = await restoreNasIndex()
    if (disk?.songs?.length) {
      setIndexInfo(`索引：${disk.songs.length} 首 / ${disk.folders.length} 个目录`)
      return
    }
    setIndexInfo('尚未建立索引：点「重建索引」可按需扫描（约 1 分钟，可随时取消）')
  }, [])

  // 读取已保存的 SMB 账号
  useEffect(() => {
    void loadSmbCreds().then(async c => {
      if (!c) return
      setSmbUser(c.user)
      setSmbPass(c.pass)
      setSmbShare(c.share || 'Multimedia')
      // 验证过一次就长期有效（卸载重装/换账号才失效）
      const ok = await loadSmbVerified(c.host, c.user)
      setSmbVerifiedState(ok)
      if (ok) {
        setSmbSaved(true)
        setSmbOpen(false)
      } else {
        setSmbSaved(false)
        setSmbOpen(true)
        setStatus('已保存 SMB 账号，请点「验证」通过后才能浏览目录')
      }
    })
  }, [])

  // 用 SMB 读 .cue 拿精确时间码；界面只留一行结论（成功/近似），不刷调试信息
  const applyExactCue = useCallback(async(stack: Crumb[], files: NasItem[]) => {
    if (!hasSmb()) return
    const creds = await loadSmbCreds()
    if (!creds?.user) {
      setCueInfo('')
      return
    }

    const titles = stack.map(c => c.title).filter(t => t && t != '根目录')
    const albumTitle = titles[titles.length - 1] || ''
    const norm = (v: string) => v.toLowerCase().replace(/[\s_\-.,·，。、\[\]【】《》()（）]/g, '')

    const readCueIn = async(rel: string, forcedCue?: string): Promise<boolean> => {
      let items: Array<{ name: string, dir: boolean }> = []
      try {
        items = await smbList(creds, rel)
      } catch {
        return false
      }
      const cueName = forcedCue ?? items.find(n => !n.dir && n.name.toLowerCase().endsWith('.cue'))?.name
      if (!cueName) return false
      try {
        const text = await smbReadText(creds, rel ? `${rel}/${cueName}` : cueName)
        const tracks = parseCue(text)
        if (!tracks.length) return false
        let total = 0
        for (const f of files) total = Math.max(total, (f.cueStart ?? 0) + (f.durationSec || 0))
        const n = applyCueTracks(files as any, tracks, total)
        if (!n) return false
        setCueInfo(`CUE：精确分轨 ${n} 轨`)
        return true
      } catch {
        return false
      }
    }

    // 0) 索引命中（扫过 CUE 的话最省事）
    try {
      await loadCueIndex()
      const hit = findCueForAlbum(albumTitle)
      if (hit && await readCueIn(hit.rel, hit.cue)) return
    } catch {}

    // 1) 面包屑末两级直接试
    const last = titles[titles.length - 1]
    const prev = titles[titles.length - 2]
    for (const cand of [prev && last ? `${prev}/${last}` : '', last].filter(Boolean)) {
      if (await readCueIn(cand)) return
    }

    // 2) 逐级下钻：从共享根按面包屑一层层对齐
    try {
      let rel = ''
      for (const seg of titles) {
        const want = norm(seg)
        if (!want || norm(creds.share || '') == want) continue
        let items: Array<{ name: string, dir: boolean }> = []
        try {
          items = await smbList(creds, rel)
        } catch {
          break
        }
        const dirs = items.filter(i => i.dir)
        // 只认「完全相等」或「互为前缀」；用「包含」会把 Music 匹配成 Mariah Carey Music Box
        const exact = dirs.find(i => norm(i.name) == want)
        const pref = exact ?? dirs
          .map(i => ({ i, n: norm(i.name) }))
          .filter(({ n }) => n.startsWith(want) || want.startsWith(n))
          .sort((a, b) => Math.abs(a.n.length - want.length) - Math.abs(b.n.length - want.length))[0]?.i
        if (!pref) continue
        rel = rel ? `${rel}/${pref.name}` : pref.name
        if (await readCueIn(rel)) return
      }
    } catch {}

    setCueInfo('CUE：未找到 .cue，按「时长近似」分轨')
  }, [])

  const loadDir = useCallback(async(dev: NasDevice, stack: Crumb[]) => {
    setLoading(true)
    try {
      const { items: list, total: dirTotal } = await browse(dev, stack[stack.length - 1].id, 0, PAGE_SIZE)
      const dirs = list.filter(i => i.isContainer).sort((a, b) => a.title.localeCompare(b.title))
      // CUE 拆轨专辑：算出每轨在整轨 wav 里的起止位置，并按音轨号排序
      const files = applyCueRanges(list.filter(i => !i.isContainer))
      await applyExactCue(stack, files)
      files.sort((a, b) => {
        const ta = a.trackNumber || 0
        const tb = b.trackNumber || 0
        if (ta && tb) return ta - tb
        return 0
      })
      for (const f of files) {
        if (typeof f.cueStart == 'number' && typeof f.cueEnd == 'number') {
          setCueRange(`nas_${f.id}`, { start: f.cueStart, end: f.cueEnd })
        }
      }
      setItems([...dirs, ...files])
      setTotal(dirTotal > 0 ? dirTotal : list.length)
      const songCount = files.filter(i => SUPPORTED_EXT.has(i.ext)).length
      const cueTracks = files.filter(i => typeof i.cueStart == 'number').length
      const cueNote = cueTracks ? `，其中 ${cueTracks} 首为 CUE 分轨（按音轨号排序，播放时自动跳到本轨起点）` : ''
      setStatus(`${stack[stack.length - 1].title}：${dirs.length} 个目录，${songCount} 首可播放${cueNote}${dirTotal > list.length ? `（共 ${dirTotal} 项）` : ''}`)
      patchNasSession({ device: dev, crumbs: stack, items: [...dirs, ...files], total: dirTotal > 0 ? dirTotal : list.length })
      persistNasSession()
    } catch (e: any) {
      setStatus(`读取失败：${e?.message ?? e}`)
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async() => {
    if (!device || !hasMore || loading) return
    setLoading(true)
    try {
      const { items: list, total: dirTotal } = await browse(device, crumbs[crumbs.length - 1].id, items.length, PAGE_SIZE)
      if (dirTotal > 0) setTotal(dirTotal)
      setItems(prev => {
        const next = [...prev, ...list]
        patchNasSession({ items: next, total: dirTotal > 0 ? dirTotal : next.length })
        persistNasSession()
        return next
      })
      setStatus(prev => `${prev.replace(/（已加载.*?）$/, '')}（已加载 ${items.length + list.length} 项）`)
    } catch (e: any) {
      setStatus(`加载更多失败：${e?.message ?? e}`)
    } finally {
      setLoading(false)
    }
  }, [crumbs, device, hasMore, items.length, loading])

  const doConnect = useCallback(async(hostValue: string) => {
    setLoading(true)
    setStatus(`正在连接 ${hostValue}…`)
    try {
      const dev = await connectDevice(hostValue)
      setDevice(dev)
      setHost(hostValue)
      patchNasSession({ host: hostValue, device: dev })
      void saveData(NAS_HOST_KEY, hostValue).catch(() => {})
      const rootStack: Crumb[] = [{ id: '0', title: '根目录' }]
      setCrumbs(rootStack)
      if (!smbVerified) {
        setSmbOpen(true)
        setStatus(`已连接 ${dev.name}：请填写并「验证」SMB 账号，通过后才能浏览目录`)
        return
      }
      setStatus(`已连接：${dev.name}`)
      await loadDir(dev, rootStack)
      setTimeout(() => { void ensureIndex(dev) }, 3000)
    } catch (e: any) {
      setStatus(`连接失败：${e?.message ?? e}`)
      setDevice(null)
      setItems([])
      setLoading(false)
    }
  }, [loadDir])

  const handleSaveSmb = useCallback(async() => {
    const h = (device?.baseUrl || host || '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
    if (!h || !smbUser.trim()) {
      setStatus('填好 SMB 用户名（以及密码）再保存')
      return
    }
    if (!hasSmb()) {
      setStatus('当前安装包缺少 SMB 模块')
      return
    }
    const creds: SmbCreds = {
      host: h,
      share: smbShare.trim() || 'Multimedia',
      user: smbUser.trim(),
      pass: smbPass,
    }
    // 先真的连一次，密码不对立刻能看出来，而不是等进专辑时静默失败
    setSmbVerifying(true)
    setStatus(`正在验证 SMB 账号 ${creds.user}@${h}/${creds.share} …`)
    try {
      resetSmbCache()
      const res = await smbProbe(creds)
      if (res.ok) {
        await saveSmbCreds({ ...creds, mode: res.mode })
        await markSmbVerified(creds.host, creds.user)
        setSmbSaved(true)
        setSmbVerifiedState(true)
        setSmbOpen(false)
        setStatus(`SMB 验证通过（${res.mode}）：共享 ${creds.share} 下有 ${res.count} 个条目`)
        if (device) {
          const rootStack: Crumb[] = [{ id: '0', title: '根目录' }]
          setCrumbs(rootStack)
          await loadDir(device, rootStack)
        }
      } else {
        await clearSmbCreds()
        await clearSmbVerified()
        setSmbSaved(false)
        setSmbVerifiedState(false)
        const detail = (res.errors ?? []).map(e => `${e.mode}: ${e.error}`).join(' ｜ ')
        setStatus(`SMB 验证失败：${detail || '未知原因'}`)
      }
    } catch (e: any) {
      setSmbSaved(false)
      setStatus(`SMB 验证异常：${e?.message ?? e}`)
    } finally {
      setSmbVerifying(false)
    }
  }, [device, host, smbUser, smbPass, smbShare])

  const handleConnect = useCallback(() => { void doConnect(host) }, [doConnect, host])



  const handleDiscover = useCallback(async() => {
    setLoading(true)
    setServers([])
    setStatus('正在搜索局域网内的音乐服务器…')
    try {
      const found = await discoverDlnaServers(3500)
      if (!found.length) {
        setStatus('没搜到服务器：可能路由器禁止组播，或 NAS 的 DLNA 未开启')
        return
      }
      const list: Array<{ name: string, host: string }> = []
      for (const s of found) {
        const h = s.location.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
        let name = s.server ?? h
        try { name = (await connectDevice(h)).name || h } catch {}
        list.push({ name, host: h })
      }
      setServers(list)
      setStatus(`发现 ${list.length} 个服务器${list.length === 1 ? '，正在连接…' : '，点选一个连接'}`)
      if (list.length === 1) await doConnect(list[0].host)
    } catch (e: any) {
      setStatus(`搜索失败：${e?.message ?? e}`)
    } finally {
      setLoading(false)
    }
  }, [doConnect])

  const handleOpen = useCallback(async(item: NasItem) => {
    if (!device) return
    if (!smbVerified) {
      setSmbOpen(true)
      setStatus('请先填写并「验证」SMB 账号，通过后才能浏览 NAS 目录')
      return
    }
    const stack = [...crumbs, { id: item.id, title: item.title }]
    setCrumbs(stack)
    await loadDir(device, stack)
  }, [crumbs, device, loadDir, smbVerified])

  const handleBack = useCallback(async() => {
    if (!device || crumbs.length <= 1) return
    const stack = crumbs.slice(0, -1)
    setCrumbs(stack)
    await loadDir(device, stack)
  }, [crumbs, device, loadDir, smbVerified])

  const ensureList = useCallback(async(name: string, infos: LX.Music.MusicInfoLocal[]) => {
    // 只认「我们自己建的」列表（id 前缀），避免覆盖用户同名列表
    let listId = listState.userList.find(l => l.name == name && l.id.startsWith(NAS_ID_PREFIX))?.id
    if (!listId) {
      listId = `${NAS_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      await createUserList(listState.userList.length, [{ id: listId, name, locationUpdateTime: null }])
    }
    await clearListMusics([listId])
    if (infos.length) await addListMusics(listId, infos, 'bottom')
    return listId
  }, [])

  // 读 NAS 上的播放列表 → 每个播放列表写成「NAS·<名称>」独立列表
  const handleLoadPlaylists = useCallback(async(silent = false) => {
    if (!device) {
      setStatus('先连接 NAS 再载入播放列表')
      return
    }
    setLoading(true)
    try {
      const detailed = await loadNasPlaylistsDetailed(device, msg => { if (!silent) setStatus(msg) })
      if (!detailed.length) {
        setStatus('NAS 上没有找到播放列表')
        return
      }
      let total = 0
      let skipped = 0
      const created: string[] = []
      for (const pl of detailed) {
        const playable = pl.songs.filter(s => SUPPORTED_EXT.has(s.ext))
        skipped += pl.songs.length - playable.length
        total += playable.length
        created.push(await ensureList(pl.title, playable.map(toMusicInfo)))
      }
      // 清理上一轮遗留的 NAS 列表（含早期合并版「NAS 音乐」）
      const keep = new Set(created)
      const stale = listState.userList
        .filter(l => (l.id.startsWith(NAS_ID_PREFIX) || l.name == NAS_LIST_NAME || l.name == NAS_TEMP_LIST || l.name.startsWith(NAS_LIST_PREFIX)) && !keep.has(l.id))
        .map(l => l.id)
      if (stale.length) await removeUserList(stale)
      markPlaylistsSynced(device.baseUrl)
      setStatus(`已同步 ${detailed.length} 个 NAS 播放列表，共 ${total} 首${skipped ? `（跳过 ${skipped} 首 DSD/APE）` : ''}，见「我的列表」`)
      return detailed.length
    } catch (e: any) {
      setStatus(`载入播放列表失败：${e?.message ?? e}`)
    } finally {
      setLoading(false)
    }
  }, [device, ensureList])

  // 连上 NAS 后自动同步一次播放列表（不依赖 handleLoadPlaylists 的引用，避免计时器被反复清掉）
  const loadPlaylistsRef = useRef(handleLoadPlaylists)
  useEffect(() => {
    loadPlaylistsRef.current = handleLoadPlaylists
  }, [handleLoadPlaylists])
  useEffect(() => {
    if (!device) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    void getPlaylistsSync().then(st => {
      if (cancelled) return
      // 这台 NAS 曾经成功同步过 → 不再自动同步（重启 App 也不重来）
      if (st.host === device.baseUrl && st.at) return
      timer = setTimeout(() => { void loadPlaylistsRef.current(true) }, 2000)
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [device])

  const handlePlay = useCallback(async(target?: NasItem) => {
    if (!smbVerified) {
      setSmbOpen(true)
      setStatus('请先验证 SMB 账号，通过后才能播放 NAS 上的歌曲')
      return
    }
    if (!audioItems.length) {
      setStatus(unsupportedCount ? '当前目录只有暂不支持的格式（DSD/APE）' : '当前目录没有可播放的歌曲')
      return
    }
    const infos = audioItems.map(toMusicInfo)
    setLoading(true)
    try {
      const playInfo = target ? infos.find(i => i.id == `nas_${target.id}`) ?? infos[0] : infos[0]
      // 用内置「试听列表」播放，不往「我的列表」里塞临时列表
      await playInTempList(infos, playInfo.id)
      setStatus(`已载入 ${infos.length} 首，正在播放：${playInfo.name}${unsupportedCount ? `（已跳过 ${unsupportedCount} 首 DSD/APE）` : ''}`)
    } catch (e: any) {
      setStatus(`播放失败：${e?.message ?? e}`)
    } finally {
      setLoading(false)
    }
  }, [audioItems, ensureList, unsupportedCount, smbVerified])

  return (
    <View style={[styles.container, { backgroundColor: theme['c-content-background'] }]}>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, isNarrow && styles.inputFull, { color: theme['c-font'], borderColor: theme['c-300'] }]}
          value={host}
          onChangeText={setHost}
          placeholder="点「自动发现」或手动输入地址"
          placeholderTextColor={theme['c-350']}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={[styles.btn, { backgroundColor: theme['c-primary'] }]} onPress={handleConnect} disabled={loading}>
          <Text style={styles.btnText}>连接</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline, { borderColor: theme['c-primary'] }]} onPress={handleDiscover} disabled={loading}>
          <Text style={[styles.btnText, { color: theme['c-primary'] }]}>自动发现</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline, { borderColor: theme['c-300'] }]} onPress={() => { void handleLoadPlaylists() }} disabled={loading || !device}>
          <Text style={[styles.btnText, { color: theme['c-font'] }]}>重新加载播放列表</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline, { borderColor: theme['c-300'] }]} onPress={() => { if (indexing) { indexAbortRef.current = true } else if (device) void buildIndex(device) }} disabled={loading || !device && !indexing}>
          <Text style={[styles.btnText, { color: theme['c-font'] }]}>{indexing ? '取消索引' : '重建索引'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline, { borderColor: theme['c-300'] }]} onPress={() => { void scanCue() }} disabled={loading || indexing || !smbSaved}>
          <Text style={[styles.btnText, { color: theme['c-font'] }]}>扫描 CUE</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline, { borderColor: smbSaved ? theme['c-300'] : theme['c-primary'] }]} onPress={() => { setSmbOpen(v => !v) }}>
          <Text style={[styles.btnText, { color: smbSaved ? theme['c-font'] : theme['c-primary'] }]}>{smbOpen ? '收起 SMB' : (smbSaved ? 'SMB 已配置' : 'SMB 设置')}</Text>
        </TouchableOpacity>
      </View>

      {smbOpen
        ? <View style={styles.row}>
          <TextInput
            style={[styles.input, isNarrow && styles.inputFull, { color: theme['c-font'], borderColor: theme['c-300'] }]}
            value={smbUser}
            onChangeText={(v) => { setSmbUser(v); setSmbSaved(false) }}
            placeholder="SMB 用户名"
            placeholderTextColor={theme['c-350']}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.input, isNarrow && styles.inputFull, { color: theme['c-font'], borderColor: theme['c-300'] }]}
            value={smbPass}
            onChangeText={(v) => { setSmbPass(v); setSmbSaved(false) }}
            placeholder="SMB 密码"
            placeholderTextColor={theme['c-350']}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.input, isNarrow && styles.inputFull, { color: theme['c-font'], borderColor: theme['c-300'] }]}
            value={smbShare}
            onChangeText={(v) => { setSmbShare(v); setSmbSaved(false) }}
            placeholder="共享名"
            placeholderTextColor={theme['c-350']}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={[styles.btn, { backgroundColor: theme['c-primary'] }]} onPress={() => { void handleSaveSmb() }} disabled={smbVerifying}>
            <Text style={styles.btnText}>{smbVerifying ? '验证中…' : (smbSaved ? '重新验证' : '验证并保存')}</Text>
          </TouchableOpacity>
        </View>
        : null}

      {cueInfo
        ? <View style={styles.indexRow}>
          <Text style={[styles.indexText, { color: cueInfo.startsWith('CUE：已') ? theme['c-primary'] : theme['c-400'] }]} numberOfLines={1}>{cueInfo}</Text>
        </View>
        : null}

      {indexing || indexInfo
        ? <View style={styles.indexRow}>
          <Text style={[styles.indexText, { color: indexing ? theme['c-primary'] : theme['c-400'] }]} numberOfLines={1}>
            {indexing ? (indexMsg || '正在建立索引…') : indexInfo}
          </Text>
          {indexing ? <ActivityIndicator size="small" color={theme['c-primary']} /> : null}
        </View>
        : null}

      {servers.length
        ? (
          <View style={styles.serverRow}>
            {servers.map(s => (
              <TouchableOpacity
                key={s.host}
                style={[styles.chip, { borderColor: theme['c-300'] }]}
                onPress={() => { void doConnect(s.host) }}
              >
                <Text style={[styles.chipText, { color: theme['c-font'] }]}>{s.name}</Text>
                <Text style={[styles.chipSub, { color: theme['c-400'] }]}>{s.host}</Text>
              </TouchableOpacity>
            ))}
          </View>
          )
        : null}

      <View style={styles.row}>
        <TouchableOpacity style={[styles.btnSmall, { borderColor: theme['c-300'] }]} onPress={handleBack} disabled={loading || crumbs.length <= 1}>
          <Text style={[styles.btnSmallText, { color: theme['c-font'] }]}>上级（{crumbs.length - 1}）</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btnSmall, { borderColor: theme['c-300'] }]} onPress={() => { void handlePlay() }} disabled={loading || !audioItems.length}>
          <Text style={[styles.btnSmallText, { color: theme['c-font'] }]}>播放全部（{audioItems.length}）</Text>
        </TouchableOpacity>
        {loading ? <ActivityIndicator color={theme['c-primary']} /> : null}
      </View>

      <Text style={[styles.status, { color: theme['c-400'] }]} numberOfLines={4}>{status}</Text>

      <FlatList
        data={items}
        keyExtractor={item => item.id}
        initialNumToRender={20}
        windowSize={10}
        renderItem={({ item }) => {
          const playable = item.isContainer || SUPPORTED_EXT.has(item.ext)
          return (
            <TouchableOpacity
              style={[styles.item, { borderBottomColor: theme['c-250'] }]}
              onPress={() => { item.isContainer ? void handleOpen(item) : void handlePlay(item) }}
            >
              <Text style={[styles.itemTitle, { color: playable ? theme['c-font'] : theme['c-350'] }]} numberOfLines={1}>
                {(item.isContainer ? '📁 ' : '🎵 ') + item.title}
              </Text>
              <Text style={[styles.itemSub, { color: theme['c-400'] }]} numberOfLines={1}>
                {item.isContainer
                  ? (item.childCount ? `${item.childCount} 项` : '目录')
                  : [item.artist, item.album, item.interval, item.ext.toUpperCase(), playable ? '' : '· 暂不支持'].filter(Boolean).join(' · ')}
              </Text>
            </TouchableOpacity>
          )
        }}
        ListFooterComponent={hasMore
          ? (
            <TouchableOpacity style={[styles.more, { borderColor: theme['c-300'] }]} onPress={loadMore} disabled={loading}>
              <Text style={[styles.moreText, { color: theme['c-primary'] }]}>
                加载更多（已显示 {items.length} / {total}）
              </Text>
            </TouchableOpacity>
            )
          : null}
        ListEmptyComponent={loading ? null : <Text style={[styles.empty, { color: theme['c-400'] }]}>暂无内容</Text>}
      />
    </View>
  )
}

const styles = createStyle({
  indexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  indexText: {
    flexShrink: 1,
    fontSize: 12,
  },
  container: { flex: 1, padding: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 },
  input: { flexGrow: 1, flexShrink: 1, minWidth: 150, height: 40, borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, fontSize: 14 },
  inputFull: { minWidth: '100%', marginBottom: 8 },
  btn: { marginLeft: 8, height: 40, paddingHorizontal: 14, borderRadius: 6, justifyContent: 'center', marginBottom: 0 },
  btnText: { color: '#fff', fontSize: 14 },
  btnSmall: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8 },
  btnOutline: { backgroundColor: 'transparent', borderWidth: 1 },
  serverRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  chip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8, marginBottom: 8 },
  chipText: { fontSize: 13 },
  chipSub: { fontSize: 11, marginTop: 2 },
  btnSmallText: { fontSize: 13 },
  status: { fontSize: 12, marginBottom: 8 },
  item: { paddingVertical: 10, borderBottomWidth: 0.5 },
  itemTitle: { fontSize: 15 },
  itemSub: { fontSize: 12, marginTop: 2 },
  more: { borderWidth: 1, borderRadius: 6, paddingVertical: 10, marginTop: 12, alignItems: 'center' },
  moreText: { fontSize: 13 },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 13 },
})
