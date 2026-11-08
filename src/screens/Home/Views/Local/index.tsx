import { useCallback, useEffect, useMemo, useState, useRef} from 'react'
import { useI18n, getMessage } from '@/lang'
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { useNavActiveId } from '@/store/common/hook'
import { createStyle } from '@/utils/tools'
import { androidVersion, hasMediaScanModule, queryAudioFiles, requestMediaPermission, type LocalAudioFile } from '@/utils/nativeModules/mediaScan'
import { playInTempList } from '@/core/nas/playHelper'
import { registerLocalProps } from '@/core/nas/mediaProps'
import { getLocalFiles, isLocalCoverStale, refreshLocalFiles, restoreLocalFiles, setLocalFiles as cacheLocalFiles } from '@/core/nas/session'
import { clearNavIntent, peekNavIntent } from '@/core/nas/navIntent'
import { playListById } from '@/core/player/player'
import listState from '@/store/list/state'

const LOCAL_LIST_NAME = getMessage('loc_title')
/** 一次最多导入多少首，避免超大歌库拖慢写库 */
const IMPORT_LIMIT = 2000

const fmtDuration = (ms: number): string | null => {
  if (!Number.isFinite(ms) || ms <= 0) return null
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const extOf = (path: string): string => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(path)
  return m ? m[1].toLowerCase() : ''
}

const toMusicInfo = (file: LocalAudioFile): LX.Music.MusicInfoLocal => ({
  id: `local_${file.path}`,
  name: (file.title ?? file.fileName ?? file.path.split('/').pop() ?? getMessage('loc_unknown')).trim(),
  singer: (file.artist ?? '').trim(),
  source: 'local',
  interval: fmtDuration(file.duration),
  meta: {
    songId: file.path,
    albumName: (file.album ?? '').trim(),
    picUrl: file.picUrl ?? null,
    filePath: file.path,
    ext: extOf(file.path),
  },
})

export default () => {
  const t = useI18n()
  const theme = useTheme()
  const [files, setFiles] = useState<LocalAudioFile[]>([])
  const [status, setStatus] = useState(t('loc_hint_scan'))
  const [loading, setLoading] = useState(false)
  const [albumFilter, setAlbumFilter] = useState<string | null>(null)
  /** 「打开所在文件夹」定位到的目录（优先于专辑过滤） */
  const [dirFilter, setDirFilter] = useState<string | null>(null)

  // 恢复上次扫描结果（菜单切换 / 重启后不用再扫）
  const navActiveId = useNavActiveId()
  const active = navActiveId == 'nav_local'
  const restoredRef = useRef(false)

  useEffect(() => {
    if (!active || restoredRef.current) return
    restoredRef.current = true
    if (!hasMediaScanModule()) {
      setStatus(t('loc_no_module'))
      return
    }
    void restoreLocalFiles().then(list => {
      if (!list.length) return
      setFiles(list)
      list.forEach(f => { registerLocalProps(f.path, { size: f.size, durationMs: f.duration }) })
      const withCover = list.filter(f => !!f.picUrl).length
      if (isLocalCoverStale()) {
        // 旧缓存（b127 之前扫的）没有封面字段 → 自动补扫一次，纯本地操作
        setStatus(t('loc_loaded_scan', { n: list.length }))
        void refreshLocalFiles().then(ok => {
          const now = getLocalFiles()
          setFiles(now)
          now.forEach(f => { registerLocalProps(f.path, { size: f.size, durationMs: f.duration }) })
          const n = now.filter(f => !!f.picUrl).length
          setStatus(ok
            ? t('loc_loaded_ok', { n: now.length, c: n })
            : t('loc_loaded_nocover', { n: now.length }))
        })
      } else {
        setStatus(t('loc_loaded_cached', { n: list.length, c: withCover }))
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!active) return
    const intent = peekNavIntent()
    if (intent?.view != 'local') return
    const targetDir = String(intent.dirPath || '').trim()
    const targetAlbum = String(intent.folder || intent.album || '').trim()
    if (!targetDir && !targetAlbum) return
    clearNavIntent()
    if (targetDir) {
      setDirFilter(targetDir)
      setAlbumFilter(null)
    } else {
      setAlbumFilter(targetAlbum)
      setDirFilter(null)
    }
  }, [active])

  const handleScan = useCallback(async() => {
    setStatus(t('loc_checking'))
    if (!hasMediaScanModule()) {
      setStatus(t('loc_module_missing'))
      return
    }
    setLoading(true)
    try {
      setStatus(t('loc_asking_perm'))
      const perm = await requestMediaPermission()
      if (!perm.granted) {
        setStatus(t('loc_no_perm', { detail: perm.detail }))
        return
      }
      setStatus(t('loc_scanning'))
      const list = await queryAudioFiles()
      list.forEach(f => { registerLocalProps(f.path, { size: f.size, durationMs: f.duration }) })
      setFiles(list)
      cacheLocalFiles(list)
      setStatus(list.length
        ? t('loc_found', { n: list.length, c: list.filter(f => !!f.picUrl).length })
        : t('loc_none'))
    } catch (e: any) {
      setStatus(t('loc_error', { msg: String(e?.message ?? e) }))
    } finally {
      setLoading(false)
    }
  }, [])

  const shown = useMemo(() => {
    let list = files
    if (dirFilter) {
      const want = dirFilter.replace(/\/+$/, '')
      list = list.filter(f => {
        const fp = String(f.path ?? '')
        const i = fp.lastIndexOf('/')
        return (i > 0 ? fp.slice(0, i) : '') == want
      })
    }
    if (albumFilter) {
      list = list.filter(f => (f.album ?? '').trim() == albumFilter || (f.album ?? '').includes(albumFilter))
    }
    return list
  }, [files, albumFilter, dirFilter])

  const handlePlay = useCallback(async(target?: LocalAudioFile) => {
    if (!files.length) return
    const picked = target ? [target] : files.slice(0, IMPORT_LIMIT)
    const infos = picked.map(toMusicInfo)
    setLoading(true)
    try {
      const playInfo = infos[0]
      await playInTempList(infos, playInfo.id)
      const extra = !target && files.length > IMPORT_LIMIT ? t('loc_imported_limit', { n: IMPORT_LIMIT }) : ''
      setStatus(t('loc_loaded_temp', { n: infos.length, extra, name: playInfo.name }))
    } catch (e: any) {
      setStatus(t('loc_play_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setLoading(false)
    }
  }, [files])

  return (
    <View style={[styles.container, { backgroundColor: theme['c-content-background'] }]}>
      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, { backgroundColor: theme['c-primary'] }]} onPress={handleScan} disabled={loading}>
          <Text style={styles.btnText}>{t('loc_scan_btn')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline, { borderColor: theme['c-300'] }]} onPress={() => { void handlePlay() }} disabled={loading || !files.length}>
          <Text style={[styles.btnText, { color: theme['c-font'] }]}>全部导入（{Math.min(files.length, IMPORT_LIMIT)}）</Text>
        </TouchableOpacity>
        {loading ? <ActivityIndicator color={theme['c-primary']} /> : null}
      </View>

      <Text style={[styles.status, { color: theme['c-400'] }]} numberOfLines={3}>{status}</Text>

      {dirFilter
        ? (
          <TouchableOpacity style={[styles.filterChip, { borderColor: theme['c-primary'] }]} onPress={() => { setDirFilter(null) }}>
            <Text style={[styles.filterText, { color: theme['c-primary'] }]}>
              {t('loc_dir_chip', { path: dirFilter.split('/').filter(Boolean).slice(-1)[0] || dirFilter })}  ✕
            </Text>
          </TouchableOpacity>
          )
        : null}
      {albumFilter
        ? (
          <TouchableOpacity style={[styles.filterChip, { borderColor: theme['c-primary'] }]} onPress={() => { setAlbumFilter(null) }}>
            <Text style={[styles.filterText, { color: theme['c-primary'] }]}>专辑：{albumFilter}  ✕</Text>
          </TouchableOpacity>
          )
        : null}

      <FlatList
        data={shown}
        keyExtractor={item => item.path}
        initialNumToRender={20}
        windowSize={10}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.item, { borderBottomColor: theme['c-250'] }]} onPress={() => { void handlePlay(item) }}>
            <Text style={[styles.itemTitle, { color: theme['c-font'] }]} numberOfLines={1}>{item.title ?? item.fileName ?? item.path}</Text>
            <Text style={[styles.itemSub, { color: theme['c-400'] }]} numberOfLines={1}>
              {[item.artist, item.album, fmtDuration(item.duration), extOf(item.path).toUpperCase()].filter(Boolean).join(' · ')}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={loading ? null : <Text style={[styles.empty, { color: theme['c-400'] }]}>{(albumFilter || dirFilter) ? t('loc_album_empty') : t('loc_not_scanned')}</Text>}
      />
    </View>
  )
}

const styles = createStyle({
  container: { flex: 1, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  btn: { height: 40, paddingHorizontal: 14, borderRadius: 6, justifyContent: 'center', marginRight: 8 },
  btnOutline: { borderWidth: 1, backgroundColor: 'transparent' },
  btnText: { color: '#fff', fontSize: 14 },
  status: { fontSize: 12, marginBottom: 8 },
  item: { paddingVertical: 10, borderBottomWidth: 0.5 },
  itemTitle: { fontSize: 15 },
  itemSub: { fontSize: 12, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 13 },
  filterChip: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  filterText: { fontSize: 12 },
})
