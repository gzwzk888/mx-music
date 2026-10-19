import { useCallback, useEffect, useMemo, useState, useRef} from 'react'
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

const LOCAL_LIST_NAME = '本机音乐'
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
  name: (file.title ?? file.fileName ?? file.path.split('/').pop() ?? '(未知)').trim(),
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
  const theme = useTheme()
  const [files, setFiles] = useState<LocalAudioFile[]>([])
  const [status, setStatus] = useState('点「扫描本机音乐」读取手机里的音频')
  const [loading, setLoading] = useState(false)
  const [albumFilter, setAlbumFilter] = useState<string | null>(null)

  // 恢复上次扫描结果（菜单切换 / 重启后不用再扫）
  const navActiveId = useNavActiveId()
  const active = navActiveId == 'nav_local'
  const restoredRef = useRef(false)

  useEffect(() => {
    if (!active || restoredRef.current) return
    restoredRef.current = true
    if (!hasMediaScanModule()) {
      setStatus('原生模块未加载，扫描不可用')
      return
    }
    void restoreLocalFiles().then(list => {
      if (!list.length) return
      setFiles(list)
      list.forEach(f => { registerLocalProps(f.path, { size: f.size, durationMs: f.duration }) })
      const withCover = list.filter(f => !!f.picUrl).length
      if (isLocalCoverStale()) {
        // 旧缓存（b127 之前扫的）没有封面字段 → 自动补扫一次，纯本地操作
        setStatus(`已载入 ${list.length} 首，封面信息缺失（旧缓存），正在补扫…`)
        void refreshLocalFiles().then(ok => {
          const now = getLocalFiles()
          setFiles(now)
          now.forEach(f => { registerLocalProps(f.path, { size: f.size, durationMs: f.duration }) })
          const n = now.filter(f => !!f.picUrl).length
          setStatus(ok
            ? `已载入 ${now.length} 首，封面 ${n} 首`
            : `已载入 ${now.length} 首，但系统未返回封面（可点「扫描本机音乐」重试）`)
        })
      } else {
        setStatus(`已载入上次扫描结果：${list.length} 首，封面 ${withCover} 首（可点「扫描本机音乐」更新）`)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const intent = peekNavIntent()
    if (intent?.view == 'local' && intent.album) {
      clearNavIntent()
      setAlbumFilter(intent.album)
    }
  }, [])

  const handleScan = useCallback(async() => {
    setStatus('正在检查环境…')
    if (!hasMediaScanModule()) {
      setStatus('原生模块缺失（打包注册问题），扫描不可用')
      return
    }
    setLoading(true)
    try {
      setStatus('正在申请读取音频权限…')
      const perm = await requestMediaPermission()
      if (!perm.granted) {
        setStatus(`没有读取音频的权限（${perm.detail}），请到系统设置里允许「音乐和音频」`)
        return
      }
      setStatus('正在扫描媒体库…')
      const list = await queryAudioFiles()
      list.forEach(f => { registerLocalProps(f.path, { size: f.size, durationMs: f.duration }) })
      setFiles(list)
      cacheLocalFiles(list)
      setStatus(list.length
        ? `找到 ${list.length} 首音频，封面 ${list.filter(f => !!f.picUrl).length} 首`
        : '媒体库里没有音频（或系统不返回文件路径）')
    } catch (e: any) {
      setStatus(`✗ 出错：${e?.message ?? e}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const shown = useMemo(() => {
    if (!albumFilter) return files
    return files.filter(f => (f.album ?? '').trim() == albumFilter || (f.album ?? '').includes(albumFilter))
  }, [files, albumFilter])

  const handlePlay = useCallback(async(target?: LocalAudioFile) => {
    if (!files.length) return
    const picked = target ? [target] : files.slice(0, IMPORT_LIMIT)
    const infos = picked.map(toMusicInfo)
    setLoading(true)
    try {
      const playInfo = infos[0]
      await playInTempList(infos, playInfo.id)
      const extra = !target && files.length > IMPORT_LIMIT ? `（已导入前 ${IMPORT_LIMIT} 首）` : ''
      setStatus(`已载入「试听列表」${infos.length} 首${extra}，正在播放：${playInfo.name}`)
    } catch (e: any) {
      setStatus(`播放失败：${e?.message ?? e}`)
    } finally {
      setLoading(false)
    }
  }, [files])

  return (
    <View style={[styles.container, { backgroundColor: theme['c-content-background'] }]}>
      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, { backgroundColor: theme['c-primary'] }]} onPress={handleScan} disabled={loading}>
          <Text style={styles.btnText}>扫描本机音乐</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline, { borderColor: theme['c-300'] }]} onPress={() => { void handlePlay() }} disabled={loading || !files.length}>
          <Text style={[styles.btnText, { color: theme['c-font'] }]}>全部导入（{Math.min(files.length, IMPORT_LIMIT)}）</Text>
        </TouchableOpacity>
        {loading ? <ActivityIndicator color={theme['c-primary']} /> : null}
      </View>

      <Text style={[styles.status, { color: theme['c-400'] }]} numberOfLines={3}>{status}</Text>

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
        ListEmptyComponent={loading ? null : <Text style={[styles.empty, { color: theme['c-400'] }]}>{albumFilter ? '这个专辑里没有本机歌曲' : '还没扫描'}</Text>}
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
