import { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useWindowSize } from '@/utils/hooks'
import { usePlayMusicInfo } from '@/store/player/hook'
import { createStyle } from '@/utils/tools'
import { getLocalProps, getRemoteSize } from '@/core/nas/mediaProps'
import { getNasIndex, restoreNasIndex } from '@/core/nas/session'
import { nasSongPathText, type NasSongIndex } from '@/core/nas/nasIndex'

const fmtSize = (bytes?: number | null) => {
  if (!bytes || bytes <= 0) return ''
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

const parseDuration = (interval?: string | null) => {
  if (!interval) return 0
  const m = /^(\d+):(\d+)(?::(\d+))?$/.exec(interval.trim())
  if (!m) return Number(interval) || 0
  return m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2])
}

/**
 * 歌曲信息弹窗（属性）
 */
export default ({ visible, onClose }: { visible: boolean, onClose: () => void }) => {
  const theme = useTheme()
  const { height: winHeight } = useWindowSize()
  const playMusicInfo = usePlayMusicInfo()
  // playMusicInfo.musicInfo 是完整对象（含 meta）；playerState.musicInfo 只有基础字段
  const musicInfo = ((playMusicInfo?.musicInfo ?? {}) as unknown) as LX.Music.MusicInfoLocal
  const meta = ((musicInfo as any).meta ?? {}) as any

  const [size, setSize] = useState<number | null>(null)
  const [sizeState, setSizeState] = useState<'idle' | 'loading' | 'done'>('idle')
  // NAS 曲目的可读路径（DLNA 只给对象 ID，得去索引里反查目录）
  const [nasPath, setNasPath] = useState('')

  const filePath = (meta.filePath ?? '') as string
  const isRemote = /^https?:\/\//i.test(filePath)
  const durationSec = parseDuration(musicInfo.interval)
  const ext = ((meta.ext as string) || filePath.split('.').pop() || '').toUpperCase()

  useEffect(() => {
    if (!visible || !isRemote) {
      setNasPath('')
      return
    }
    let alive = true
    void (async() => {
      try {
        const idx = getNasIndex() ?? await restoreNasIndex()
        const hit: NasSongIndex | undefined = idx?.songs?.find(s => s.url === filePath)
        if (!alive) return
        setNasPath(hit ? nasSongPathText(hit.folder, hit.title, hit.ext) : '')
      } catch {
        if (alive) setNasPath('')
      }
    })()
    return () => { alive = false }
  }, [visible, isRemote, filePath])

  useEffect(() => {
    if (!visible) return
    setSize(null)
    const local = getLocalProps(filePath)
    if (local?.size) {
      setSize(local.size)
      setSizeState('done')
    } else if (isRemote) {
      setSizeState('loading')
      void getRemoteSize(filePath).then(v => {
        setSize(v)
        setSizeState('done')
      })
    } else {
      setSizeState('done')
    }
  }, [visible, filePath, isRemote])

  const bitrate = size && durationSec ? `${Math.round(size * 8 / durationSec / 1000)} kbps` : ''

  const rows = useMemo(() => ([
    { label: '歌曲', value: musicInfo.name || '—' },
    { label: '艺人', value: musicInfo.singer || '—' },
    { label: '专辑', value: (meta.albumName as string) || '—' },
    { label: '时长', value: musicInfo.interval || (durationSec ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}` : '—') },
    { label: '格式', value: ext || '—' },
    { label: '大小', value: fmtSize(size) || (sizeState == 'loading' ? '读取中…' : '—') },
    { label: '平均码率', value: bitrate || '—' },
    { label: '来源', value: isRemote ? 'NAS / 音乐服务器' : (filePath ? '本机文件' : '—') },
    { label: '路径', value: isRemote ? (nasPath || '（NAS 未提供目录信息）') : (filePath || '—'), small: true },
  ]), [musicInfo, musicInfo.name, musicInfo.singer, musicInfo.interval, meta.albumName, ext, size, sizeState, bitrate, isRemote, filePath, durationSec, nasPath])

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.mask} onPress={onClose}>
        <View style={{ ...styles.card, backgroundColor: theme['c-content-background'] }} onStartShouldSetResponder={() => true}>
          <View style={{ ...styles.header, borderBottomColor: theme['c-border-background'] }}>
            <Text size={16} color={theme['c-font']}>歌曲信息</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={18} color={theme['c-350']} />
            </TouchableOpacity>
          </View>

          <ScrollView style={[styles.body, { maxHeight: Math.max(200, winHeight * 0.62) }]} contentContainerStyle={styles.bodyContent}>
            {rows.map(row => (
              <View key={row.label} style={styles.row}>
                <Text style={styles.label} size={13} color={theme['c-400']}>{row.label}</Text>
                <Text style={styles.value} size={row.small ? 11 : 13} color={theme['c-font']} selectable>{row.value}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  )
}

const styles = createStyle({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '82%',
    borderRadius: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  closeBtn: { padding: 2 },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingHorizontal: 16, paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 5,
  },
  label: { width: 76 },
  value: { flex: 1 },
})
