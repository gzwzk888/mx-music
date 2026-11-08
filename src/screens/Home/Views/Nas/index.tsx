/**
 * NAS 曲库（阶段 A 重构）
 * 三层结构：设备列表（默认）→ 浏览 → 高级
 * 主路径不再要求 SMB：DLNA 就能浏览与播放；SMB 只为读 .cue 精确分轨。
 */
import { useI18n, getMessage } from '@/lang'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { useNavActiveId } from '@/store/common/hook'
import { applyCueRanges, browse, connectDevice, toMusicInfo, type NasDevice, type NasItem } from '@/core/nas/dlna'
import { applyCueTracks, parseCue } from '@/core/nas/cue'
import { buildCueIndex, findCueForAlbum, loadCueIndex } from '@/core/nas/cueIndex'
import { setCueRange } from '@/core/nas/cueRanges'
import { isSmbVerified, loadSmbVerified, markSmbVerified, clearSmbVerified } from '@/core/nas/smbSession'
import { loadSmbCreds, saveSmbCreds, clearSmbCreds, smbProbe, smbList, smbReadText, hasSmb, resetSmbCache, type SmbCreds } from '@/utils/nativeModules/smb'
import { discoverDlnaServers } from '@/utils/nativeModules/mediaScan'
import { addListMusics, clearListMusics, createUserList, removeUserList } from '@/core/list'
import listState from '@/store/list/state'
import { getData, saveData } from '@/plugins/storage'
import settingState from '@/store/setting/state'
import { getNasIndex, getPlaylistsSync, markPlaylistsSynced, patchNasSession, persistNasSession, restoreNasIndex, restoreNasSession, setNasIndex } from '@/core/nas/session'
import { buildFolderStack, buildNasIndex, findFolderByTitle } from '@/core/nas/nasIndex'
import { scanNasCovers } from '@/core/nas/coverScan'
import { clearNavIntent, peekNavIntent } from '@/core/nas/navIntent'
import { loadNasPlaylistsDetailed } from '@/core/nas/nasPlaylists'
import { playInTempList } from '@/core/nas/playHelper'
import DeviceList from './DeviceList'
import Browse, { type Crumb } from './Browse'
import Advanced from './Advanced'

const NAS_HOST_KEY = '@nas_host'
const NAS_DEVICES_KEY = '@nas_devices_v1'

const NAS_LIST_NAME = getMessage('nas_title')   // 旧的合并列表名，仅用于清理
const NAS_LIST_PREFIX = 'NAS·'   // 旧命名前缀（仅用于清理）
const NAS_ID_PREFIX = 'userlist_nas_'
const NAS_TEMP_LIST = getMessage('nas_cur_dir')
const PAGE_SIZE = 300
/** ExoPlayer 能直接播的格式；dsf/dff(DSD)、ape 暂不支持，导入时跳过 */
const SUPPORTED_EXT = new Set(['flac', 'wav', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'alac', 'mka', 'mp2'])

interface KnownDevice { name: string, host: string }

export default () => {
  const t = useI18n()
  const [view, setView] = useState<'list' | 'browse' | 'advanced'>('list')
  const [host, setHost] = useState('')
  const [device, setDevice] = useState<NasDevice | null>(null)
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: '0', title: t('nas_root') }])
  const [items, setItems] = useState<NasItem[]>([])
  const [total, setTotal] = useState(0)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [devices, setDevices] = useState<KnownDevice[]>([])
  const [indexing, setIndexing] = useState(false)
  const [indexMsg, setIndexMsg] = useState('')
  const [indexInfo, setIndexInfo] = useState('')
  const [cueInfo, setCueInfo] = useState('')
  const [smbUser, setSmbUser] = useState('')
  const [smbPass, setSmbPass] = useState('')
  const [smbShare, setSmbShare] = useState('Multimedia')
  const [smbSaved, setSmbSaved] = useState(false)
  const [smbVerifying, setSmbVerifying] = useState(false)
  const [smbVerified, setSmbVerifiedState] = useState(isSmbVerified)
  const indexAbortRef = useRef(false)
  const scanningCoversRef = useRef(false)

  const navActiveId = useNavActiveId()
  const active = navActiveId == 'nav_nas'
  const bootRef = useRef(false)

  const rememberDevice = useCallback(async(dev: NasDevice, hostValue: string) => {
    const list = (await getData<Array<KnownDevice>>(NAS_DEVICES_KEY).catch(() => null)) ?? []
    const next = [{ name: dev.name || hostValue, host: hostValue }, ...list.filter(d => d.host != hostValue)].slice(0, 12)
    setDevices(next)
    void saveData(NAS_DEVICES_KEY, next).catch(() => {})
    void saveData(NAS_HOST_KEY, hostValue).catch(() => {})
  }, [])

  /* ------------------------------ 目录与播放 ------------------------------ */

  const applyExactCue = useCallback(async(stack: Crumb[], files: NasItem[]) => {
    if (!hasSmb()) return
    const creds = await loadSmbCreds()
    if (!creds?.user) {
      setCueInfo('')
      return
    }

    const titles = stack.map(c => c.title).filter(x => x && x != t('nas_root'))
    const albumTitle = titles[titles.length - 1] || ''
    const norm = (v: string) => v.toLowerCase().replace(/[\s_\-.,·，。、\[\]【】《》()（）]/g, '')

    const readCueIn = async(rel: string, forcedCue?: string): Promise<boolean> => {
      let list: Array<{ name: string, dir: boolean }> = []
      try {
        list = await smbList(creds, rel)
      } catch {
        return false
      }
      const cueName = forcedCue ?? list.find(n => !n.dir && n.name.toLowerCase().endsWith('.cue'))?.name
      if (!cueName) return false
      try {
        const text = await smbReadText(creds, rel ? `${rel}/${cueName}` : cueName)
        const tracks = parseCue(text)
        if (!tracks.length) return false
        let dur = 0
        for (const f of files) dur = Math.max(dur, (f.cueStart ?? 0) + (f.durationSec || 0))
        const n = applyCueTracks(files as any, tracks, dur)
        if (!n) return false
        setCueInfo(t('nas_cue_precise', { n }))
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
        let list: Array<{ name: string, dir: boolean }> = []
        try {
          list = await smbList(creds, rel)
        } catch {
          break
        }
        const dirs = list.filter(i => i.dir)
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

    setCueInfo(t('nas_cue_approx'))
  }, [])

  const loadDir = useCallback(async(dev: NasDevice, stack: Crumb[]) => {
    setLoading(true)
    setCueInfo('')
    try {
      const { items: list, total: dirTotal } = await browse(dev, stack[stack.length - 1].id, 0, PAGE_SIZE)
      const dirs = list.filter(i => i.isContainer).sort((a, b) => a.title.localeCompare(b.title))
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
      const next = [...dirs, ...files]
      setItems(next)
      setTotal(dirTotal > 0 ? dirTotal : list.length)
      setMessage('')
      patchNasSession({ device: dev, crumbs: stack, items: next, total: dirTotal > 0 ? dirTotal : list.length })
      persistNasSession()
    } catch (e: any) {
      setMessage(t('nas_read_fail', { msg: String(e?.message ?? e) }))
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [applyExactCue])

  const loadMore = useCallback(async() => {
    if (!device || loading) return
    if (total <= items.length) return
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
    } catch (e: any) {
      setMessage(t('nas_more_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setLoading(false)
    }
  }, [crumbs, device, items.length, loading, total])

  /* -------------------------------- 索引 -------------------------------- */

  const buildIndex = useCallback(async(dev: NasDevice, silent = false) => {
    setIndexing(true)
    setIndexMsg(t('nas_indexing'))
    if (!silent) setMessage('')
    try {
      indexAbortRef.current = false
      const idx = await buildNasIndex(dev, msg => { setIndexMsg(msg) }, () => indexAbortRef.current, { force: true })
      setNasIndex(idx)
      setIndexInfo(t('nas_index_size', { s: idx.songs.length, f: idx.folders.length }))
      // 不再自动全量扫封面（上万首要跑一两个小时，体验上得不偿失）：
      // 改为列表按需惰性读取 —— 谁上屏谁去拿，拿到即写本地缓存（见 dirs.ts 封面队列）
      setIndexMsg('')
    } catch (e: any) {
      setIndexMsg('')
      if (!silent) setMessage(t('nas_index_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setIndexing(false)
    }
  }, [])

  /** 只补封面缓存（不动索引） */
  const scanCovers = useCallback(async() => {
    if (scanningCoversRef.current) return
    scanningCoversRef.current = true
    setIndexing(true)
    try {
      indexAbortRef.current = false
      const r = await scanNasCovers(
        p => { setIndexMsg(t('nas_cover_scanning', { done: p.done, total: p.total, w: 0 })) },
        () => indexAbortRef.current,
      )
      setIndexMsg('')
      if (r) {
        setIndexInfo(t('nas_cover_done', { ok: r.ok, none: r.none, fail: r.fail }))
      }
    } catch (e: any) {
      setIndexMsg('')
      setMessage(`${t('nas_cover_scan')}：${String(e?.message ?? e)}`)
    } finally {
      scanningCoversRef.current = false
      setIndexing(false)
    }
  }, [t])

  /** 距上次索引超过设定天数就静默重建一次（不用手动点） */
  const maybeAutoRebuild = useCallback(async(dev: NasDevice) => {
    const days = Number(settingState.setting['nas.autoRebuildDays'] ?? 3)
    if (!days || days <= 0) return
    try {
      const idx = getNasIndex() ?? await restoreNasIndex()
      const builtAt = idx?.builtAt ?? 0
      if (!builtAt) return
      if (Date.now() - builtAt < days * 86400000) return
      await buildIndex(dev, true)
    } catch {}
  }, [buildIndex])

  const scanCue = useCallback(async() => {
    if (indexing) return
    const creds = await loadSmbCreds()
    if (!creds?.user) {
      setMessage(t('nas_smb_first'))
      return
    }
    setIndexing(true)
    indexAbortRef.current = false
    try {
      setIndexMsg(t('nas_cue_scanning'))
      const entries = await buildCueIndex(creds, msg => { setIndexMsg(msg) }, () => indexAbortRef.current)
      setMessage(t('nas_cue_done', { n: entries.length }))
    } catch (e: any) {
      setMessage(t('nas_cue_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setIndexMsg('')
      setIndexing(false)
    }
  }, [indexing])

  const ensureIndex = useCallback(async(dev: NasDevice) => {
    const mem = getNasIndex()
    if (mem?.songs?.length) {
      setIndexInfo(t('nas_index_size', { s: mem.songs.length, f: mem.folders.length }))
      return
    }
    const disk = await restoreNasIndex()
    if (disk?.songs?.length) {
      setIndexInfo(t('nas_index_size', { s: disk.songs.length, f: disk.folders.length }))
      return
    }
    setIndexInfo('')
    // 没有索引：连上后静默建一次（WiiM 的做法），进度只占高级里一行
    void buildIndex(dev, true)
  }, [buildIndex])

  /* ------------------------------- 连接 -------------------------------- */

  const doConnect = useCallback(async(hostValue: string, silent = false) => {
    const value = hostValue.trim()
    if (!value) return
    setLoading(true)
    if (!silent) setMessage(t('nas_connecting', { name: value }))
    try {
      const dev = await connectDevice(value)
      setDevice(dev)
      setHost(value)
      patchNasSession({ host: value, device: dev })
      void rememberDevice(dev, value)
      const rootStack: Crumb[] = [{ id: '0', title: t('nas_root') }]
      setCrumbs(rootStack)
      setView('browse')
      setMessage('')
      await loadDir(dev, rootStack)
      void ensureIndex(dev)
      void maybeAutoRebuild(dev)
    } catch (e: any) {
      setMessage(t('nas_connect_fail', { msg: String(e?.message ?? e) }))
      setDevice(null)
      setItems([])
      setView('list')
    } finally {
      setLoading(false)
    }
  }, [ensureIndex, loadDir, maybeAutoRebuild, rememberDevice])

  const handleDiscover = useCallback(async(silent = false) => {
    setScanning(true)
    setScanned(false)
    if (!silent) setMessage('')
    try {
      const found = await discoverDlnaServers(3500)
      const list: KnownDevice[] = []
      for (const s of found) {
        const h = s.location.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
        let name = s.server ?? h
        try { name = (await connectDevice(h)).name || h } catch {}
        list.push({ name, host: h })
      }
      setScanned(true)
      if (!list.length) {
        if (!silent) setMessage(t('nas_no_server'))
        return
      }
      // 已记住的设备排前面
      const known = (await getData<Array<KnownDevice>>(NAS_DEVICES_KEY).catch(() => null)) ?? []
      const merged = [...list, ...known.filter(k => !list.some(l => l.host == k.host))]
      setDevices(merged)
      void saveData(NAS_DEVICES_KEY, merged).catch(() => {})
      if (list.length == 1 && !silent) await doConnect(list[0].host)
    } catch (e: any) {
      setScanned(true)
      if (!silent) setMessage(t('nas_scan_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setScanning(false)
    }
  }, [doConnect])

  // 首次进入：恢复上次会话；没有就自动扫一次
  useEffect(() => {
    if (!active || bootRef.current) return
    bootRef.current = true
    // 「打开所在文件夹」跳转：交给下面的专用 effect 处理，
    // 否则这里的 doConnect 会异步把 crumbs 重置成 Root，把跳转覆盖掉
    const jump = peekNavIntent()
    if (jump?.view === 'nas' && jump.folder) return
    void (async() => {
      const known = (await getData<Array<KnownDevice>>(NAS_DEVICES_KEY).catch(() => null)) ?? []
      const lastHost = await getData<string>(NAS_HOST_KEY).catch(() => null)
      if (known.length) setDevices(known)
      const session = await restoreNasSession()
      if (session.host) setHost(session.host)

      // 歌单点专辑 → 直接跳到对应目录
      const intent = peekNavIntent()
      if (intent?.view == 'nas' && intent.album && !intent.folder) {
        clearNavIntent()
        const idx = await restoreNasIndex()
        const folder = idx ? findFolderByTitle(idx.folders, intent.album) : null
        const targetHost = session.host || lastHost
        if (targetHost) {
          try {
            const dev = session.device ?? await connectDevice(targetHost)
            setDevice(dev)
            setHost(targetHost)
            const stack: Crumb[] = folder
              ? [{ id: '0', title: t('nas_root') }, { id: folder.id, title: folder.title }]
              : [{ id: '0', title: t('nas_root') }]
            setCrumbs(stack)
            setView('browse')
            await loadDir(dev, stack)
            return
          } catch {}
        }
      }

      if (lastHost) {
        void doConnect(lastHost, true)
        return
      }
      void handleDiscover(true)
    })().catch(() => {})
  }, [active, doConnect, handleDiscover, loadDir])

  // 「打开所在文件夹」：从音乐库 / 最近随机跳过来，定位到那首歌所在目录（完整面包屑）
  useEffect(() => {
    if (!active) return
    const intent = peekNavIntent()
    if (intent?.view !== 'nas' || !intent.folder) return
    clearNavIntent()
    void (async() => {
      const session = await restoreNasSession()
      const lastHost = session.host || (await getData<string>(NAS_HOST_KEY).catch(() => null))
      if (!lastHost) return
      try {
        const dev = session.device ?? await connectDevice(lastHost)
        setDevice(dev)
        setHost(lastHost)
        const idx = await restoreNasIndex()
        const chain = idx ? buildFolderStack(idx.folders, intent.folder!) : []
        const stack: Crumb[] = [
          { id: '0', title: t('nas_root') },
          ...chain.map(f => ({ id: f.id, title: f.title })),
        ]
        setCrumbs(stack)
        setView('browse')
        if (!chain.length) setMessage(t('lib_no_path'))
        await loadDir(dev, stack)
      } catch {}
    })()
  }, [active, loadDir, t])

  // 读取已保存的 SMB 账号（只为 CUE，不再作为门槛）
  useEffect(() => {
    if (!active) return
    void loadSmbCreds().then(async c => {
      if (!c) return
      setSmbUser(c.user)
      setSmbPass(c.pass)
      setSmbShare(c.share || 'Multimedia')
      const ok = await loadSmbVerified(c.host, c.user)
      setSmbVerifiedState(ok)
      setSmbSaved(ok)
    }).catch(() => {})
  }, [active])

  const handleSaveSmb = useCallback(async() => {
    const h = (device?.baseUrl || host || '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
    if (!h || !smbUser.trim()) {
      setMessage(t('nas_need_smb'))
      return
    }
    if (!hasSmb()) {
      setMessage(t('nas_no_smb_module'))
      return
    }
    const creds: SmbCreds = {
      host: h,
      share: smbShare.trim() || 'Multimedia',
      user: smbUser.trim(),
      pass: smbPass,
    }
    setSmbVerifying(true)
    setMessage(t('nas_smb_verifying', { user: creds.user, host: h, share: creds.share }))
    try {
      resetSmbCache()
      const res = await smbProbe(creds)
      if (res.ok) {
        await saveSmbCreds({ ...creds, mode: res.mode })
        await markSmbVerified(creds.host, creds.user)
        setSmbSaved(true)
        setSmbVerifiedState(true)
        setMessage(t('nas_smb_ok', { mode: String(res.mode ?? ''), share: creds.share, n: res.count ?? 0 }))
        if (device) {
          const stack = crumbs.length ? crumbs : [{ id: '0', title: t('nas_root') }]
          await loadDir(device, stack)
        }
      } else {
        await clearSmbCreds()
        await clearSmbVerified()
        setSmbSaved(false)
        setSmbVerifiedState(false)
        const detail = (res.errors ?? []).map(e => `${e.mode}: ${e.error}`).join(' ｜ ')
        setMessage(`SMB 验证失败：${detail || t('nas_unknown_err')}`)
      }
    } catch (e: any) {
      setSmbSaved(false)
      setMessage(t('nas_smb_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setSmbVerifying(false)
    }
  }, [crumbs, device, host, loadDir, smbPass, smbShare, smbUser])

  // 长按卡片：只从「已知服务器」里删掉，不动当前连接（除非删的就是当前这台）
  const forgetDevice = useCallback(async(hostValue: string) => {
    const next = devices.filter(d => d.host != hostValue)
    setDevices(next)
    void saveData(NAS_DEVICES_KEY, next).catch(() => {})
    if (hostValue == host) {
      setDevice(null)
      setItems([])
      setTotal(0)
      setCrumbs([{ id: '0', title: t('nas_root') }])
      setHost('')
      void saveData(NAS_HOST_KEY, '').catch(() => {})
      patchNasSession({ host: '', device: null, crumbs: [], items: [] })
      persistNasSession()
      setMessage(t('nas_device_removed'))
      return
    }
    setMessage(t('nas_removed_from_list', { host: hostValue }))
  }, [devices, host])

  const handleForget = useCallback(async() => {
    await clearSmbVerified().catch(() => {})
    setSmbVerifiedState(false)
    patchNasSession({ host: '', device: null, crumbs: [], items: [] })
    persistNasSession()
    void saveData(NAS_HOST_KEY, '').catch(() => {})
    setDevice(null)
    setItems([])
    setTotal(0)
    setCrumbs([{ id: '0', title: t('nas_root') }])
    setCueInfo('')
    setView('list')
    setMessage(t('nas_disconnected'))
    void handleDiscover(true)
  }, [handleDiscover])

  /* ------------------------------ 播放列表 ------------------------------ */

  const ensureList = useCallback(async(name: string, infos: LX.Music.MusicInfoLocal[]) => {
    let listId = listState.userList.find(l => l.name == name && l.id.startsWith(NAS_ID_PREFIX))?.id
    if (!listId) {
      listId = `${NAS_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      await createUserList(listState.userList.length, [{ id: listId, name, locationUpdateTime: null }])
    }
    await clearListMusics([listId])
    if (infos.length) await addListMusics(listId, infos, 'bottom')
    return listId
  }, [])

  const handleLoadPlaylists = useCallback(async(silent = false) => {
    if (!device) {
      setMessage(t('nas_connect_first'))
      return
    }
    setLoading(true)
    try {
      const detailed = await loadNasPlaylistsDetailed(device, msg => { if (!silent) setMessage(msg) })
      if (!detailed.length) {
        if (!silent) setMessage(t('nas_no_playlists'))
        return
      }
      let songs = 0
      let skipped = 0
      const created: string[] = []
      for (const pl of detailed) {
        const playable = pl.songs.filter(s => SUPPORTED_EXT.has(s.ext))
        skipped += pl.songs.length - playable.length
        songs += playable.length
        created.push(await ensureList(pl.title, playable.map(toMusicInfo)))
      }
      const keep = new Set(created)
      const stale = listState.userList
        .filter(l => (l.id.startsWith(NAS_ID_PREFIX) || l.name == NAS_LIST_NAME || l.name == NAS_TEMP_LIST || l.name.startsWith(NAS_LIST_PREFIX)) && !keep.has(l.id))
        .map(l => l.id)
      if (stale.length) await removeUserList(stale)
      markPlaylistsSynced(device.baseUrl)
      setMessage(`已同步 ${detailed.length} 个播放列表，共 ${songs} 首${skipped ? `（跳过 ${skipped} 首 DSD/APE）` : ''}，见「我的列表」`)
    } catch (e: any) {
      if (!silent) setMessage(t('nas_pl_load_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setLoading(false)
    }
  }, [device, ensureList])

  const loadPlaylistsRef = useRef(handleLoadPlaylists)
  useEffect(() => { loadPlaylistsRef.current = handleLoadPlaylists }, [handleLoadPlaylists])
  useEffect(() => {
    if (!device) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    void getPlaylistsSync().then(st => {
      if (cancelled) return
      if (st.host === device.baseUrl && st.at) return
      timer = setTimeout(() => { void loadPlaylistsRef.current(true) }, 2500)
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [device])

  /* -------------------------------- 播放 -------------------------------- */

  const audioItems = useMemo(
    () => items.filter(i => !i.isContainer && i.url && SUPPORTED_EXT.has(i.ext)),
    [items],
  )
  const unsupportedCount = useMemo(
    () => items.filter(i => !i.isContainer && i.url && !SUPPORTED_EXT.has(i.ext)).length,
    [items],
  )

  const handlePlay = useCallback(async(target?: NasItem) => {
    if (!audioItems.length) {
      setMessage(unsupportedCount ? t('nas_dsd_only') : t('nas_no_playable'))
      return
    }
    const infos = audioItems.map(toMusicInfo)
    setLoading(true)
    try {
      const playInfo = target ? infos.find(i => i.id == `nas_${target.id}`) ?? infos[0] : infos[0]
      await playInTempList(infos, playInfo.id)
      setMessage('')
    } catch (e: any) {
      setMessage(t('nas_play_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setLoading(false)
    }
  }, [audioItems, unsupportedCount])

  const handleOpen = useCallback(async(item: NasItem) => {
    if (!device) return
    const stack = [...crumbs, { id: item.id, title: item.title }]
    setCrumbs(stack)
    await loadDir(device, stack)
  }, [crumbs, device, loadDir])

  const handleCrumb = useCallback(async(index: number) => {
    if (!device) return
    const stack = crumbs.slice(0, index + 1)
    setCrumbs(stack)
    await loadDir(device, stack)
  }, [crumbs, device, loadDir])

  const note = cueInfo || indexMsg || indexInfo

  if (view == 'list') {
    return (
      <DeviceList
        servers={devices.map((d, i) => ({ ...d, last: i == 0 && !!host && d.host == host }))}
        scanning={scanning}
        scanned={scanned}
        message={message}
        busy={loading || scanning}
        onScan={() => { void handleDiscover() }}
        onPick={h => { void doConnect(h) }}
        onLongPressDevice={h => { void forgetDevice(h) }}
        onAdvanced={() => setView('advanced')}
      />
    )
  }

  if (view == 'advanced') {
    return (
      <Advanced
        deviceName={device?.name ?? ''}
        host={host}
        onManualConnect={v => { void doConnect(v) }}
        smbUser={smbUser}
        smbPass={smbPass}
        smbShare={smbShare}
        setSmbUser={v => { setSmbUser(v); setSmbSaved(false) }}
        setSmbPass={v => { setSmbPass(v); setSmbSaved(false) }}
        setSmbShare={v => { setSmbShare(v); setSmbSaved(false) }}
        smbSaved={smbSaved}
        smbVerifying={smbVerifying}
        onSaveSmb={() => { void handleSaveSmb() }}
        indexing={indexing}
        indexMsg={indexMsg}
        indexInfo={indexInfo}
        onRebuildIndex={() => { if (device) void buildIndex(device) }}
        onScanCovers={() => { void scanCovers() }}
        onCancelIndex={() => { indexAbortRef.current = true }}
        onScanCue={() => { void scanCue() }}
        onReloadPlaylists={() => { void handleLoadPlaylists() }}
        onForget={() => { void handleForget() }}
        message={message}
        onBack={() => setView(device ? 'browse' : 'list')}
      />
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <Browse
        deviceName={device?.name ?? ''}
        host={host}
        crumbs={crumbs}
        items={items}
        total={total}
        loading={loading}
        hasMore={total > items.length}
        playableCount={audioItems.length}
        note={note}
        message={message}
        onUp={() => { void handleCrumb(crumbs.length - 2) }}
        onExit={() => setView('list')}
        onCrumb={i => { void handleCrumb(i) }}
        onOpen={item => { void handleOpen(item) }}
        onPlay={item => { void handlePlay(item) }}
        onLoadMore={() => { void loadMore() }}
        onAdvanced={() => setView('advanced')}
        onRebuildIndex={() => { if (device) void buildIndex(device) }}
      />
    </View>
  )
}
