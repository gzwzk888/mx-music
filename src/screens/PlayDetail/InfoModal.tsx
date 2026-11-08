import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/lang'
import { Modal, Pressable, ScrollView, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useWindowSize } from '@/utils/hooks'
import { usePlayMusicInfo } from '@/store/player/hook'
import { createStyle } from '@/utils/tools'
import { getLocalProps, getRemoteSize } from '@/core/nas/mediaProps'
import { ensureLoaded, getSongs } from '@/core/local/dirs'
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
  const t = useI18n()
  const theme = useTheme()
  const { width: winWidth, height: winHeight } = useWindowSize()
  const wide = winWidth > winHeight
  const playMusicInfo = usePlayMusicInfo()
  // playMusicInfo.musicInfo 是完整对象（含 meta）；playerState.musicInfo 只有基础字段
  const musicInfo = ((playMusicInfo?.musicInfo ?? {}) as unknown) as LX.Music.MusicInfoLocal
  const meta = ((musicInfo as any).meta ?? {}) as any

  const [size, setSize] = useState<number | null>(null)
  const [sizeState, setSizeState] = useState<'idle' | 'loading' | 'done'>('idle')
  // NAS 曲目的可读路径（DLNA 只给对象 ID，得去索引里反查目录）
  const [nasPath, setNasPath] = useState('')

  const filePath = String(meta.filePath ?? meta.songId ?? '')
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
      return
    }
    setSizeState('loading')
    let alive = true
    void (async() => {
      // 本机文件：从「音乐库」曲库里拿 size（MediaStore 属性接口在部分机型上给不出）
      try {
        await ensureLoaded()
        const hit = getSongs().find(s => s.path == filePath || s.path == String(meta.songId ?? ''))
        if (!alive) return
        if (hit?.size) {
          setSize(hit.size)
          setSizeState('done')
          return
        }
      } catch {}
      if (isRemote) {
        try {
          const v = await getRemoteSize(filePath)
          if (alive) setSize(v)
        } catch {}
      }
      if (alive) setSizeState('done')
    })()
    return () => { alive = false }
  }, [visible, filePath, isRemote])

  const bitrate = size && durationSec ? `${Math.round(size * 8 / durationSec / 1000)} kbps` : ''

  const rows = useMemo(() => ([
    { label: t('info_song'), value: musicInfo.name || '—' },
    { label: t('info_artist'), value: musicInfo.singer || '—' },
    { label: t('info_album'), value: (meta.albumName as string) || '—' },
    { label: t('info_duration'), value: musicInfo.interval || (durationSec ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}` : '—') },
    { label: t('info_format'), value: ext || '—' },
    { label: t('info_size'), value: fmtSize(size) || (sizeState == 'loading' ? t('info_reading') : '—') },
    { label: t('info_bitrate'), value: bitrate || '—' },
    { label: t('info_source'), value: isRemote ? t('info_nas') : (filePath ? t('info_local') : '—') },
    { label: t('info_path'), value: isRemote ? (nasPath || t('info_no_nas_dir')) : (filePath || '—'), small: true },
  ]), [t, musicInfo, musicInfo.name, musicInfo.singer, musicInfo.interval, meta.albumName, ext, size, sizeState, bitrate, isRemote, filePath, durationSec, nasPath])

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.mask} onPress={onClose}>
        <View style={{ ...styles.card, backgroundColor: theme['c-content-background'] }} onStartShouldSetResponder={() => true}>
          <View style={{ ...styles.header, borderBottomColor: theme['c-border-background'] }}>
            <Text size={16} color={theme['c-font']}>{t('info_title')}</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={18} color={theme['c-350']} />
            </TouchableOpacity>
          </View>

          <ScrollView style={[styles.body, { maxHeight: Math.max(220, winHeight * (wide ? 0.92 : 0.66)) }]} contentContainerStyle={wide ? styles.bodyContentWide : styles.bodyContent}>
            {rows.map(row => (
              <View key={row.label} style={[styles.row, wide ? styles.rowWide : null]}>
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
    maxHeight: '94%',
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
  bodyContentWide: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', flexWrap: 'wrap' },
  rowWide: { width: '50%', paddingRight: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 5,
  },
  label: { width: 76 },
  value: { flex: 1 },
})
