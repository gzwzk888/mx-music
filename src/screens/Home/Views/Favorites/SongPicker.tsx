import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, Modal, TextInput, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { useI18n } from '@/lang'
import { MxLoading } from '@/components/mx'
import { IconBack, IconCheck } from '@/components/mx/Icons'
import { ensureLoaded, getSongs, type LocalSong } from '@/core/local/dirs'
import { getNasIndex, restoreNasIndex, isNasReachable } from '@/core/nas/session'
import type { NasSongIndex } from '@/core/nas/nasIndex'
import { addListMusics } from '@/core/list'

/**
 * 选歌加入列表：从「本机曲库 + NAS 索引」里多选歌曲，一次性加进指定列表。
 * 存在的原因：原来只能一首一首走「⋯ → 添加到播放列表」，建了新列表也没法快速装满。
 */

interface PickSong {
  key: string
  info: LX.Music.MusicInfo
  name: string
  sub: string
}

const extOf = (path: string) => (/\.([a-z0-9]{2,5})$/i.exec(path)?.[1] ?? '').toLowerCase()

const fmtDuration = (ms: number): string | null => {
  if (!Number.isFinite(ms) || ms <= 0) return null
  const total = Math.floor(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const fromLocal = (song: LocalSong): PickSong => {
  const ext = extOf(song.path)
  return {
    key: `local_${song.path}`,
    name: song.title || song.fileName,
    sub: [song.artist, song.album].filter(Boolean).join(' · '),
    info: {
      id: `local_${song.path}`,
      name: song.title || song.fileName,
      singer: song.artist || '',
      source: 'local',
      interval: fmtDuration(song.duration),
      meta: {
        songId: song.path,
        albumName: song.album || '',
        picUrl: null,
        filePath: song.path,
        ext,
      },
    } as unknown as LX.Music.MusicInfo,
  }
}

const fromNas = (song: NasSongIndex): PickSong => {
  const name = song.title?.trim() || '(未命名)'
  return {
    key: `nas_${song.id}`,
    name,
    sub: [song.artist?.trim(), song.album?.trim()].filter(Boolean).join(' · '),
    info: {
      id: `nas_${song.id}`,
      name,
      singer: song.artist?.trim() ?? '',
      source: 'local',
      interval: song.interval ?? null,
      meta: {
        songId: song.url,
        albumName: song.album?.trim() ?? '',
        picUrl: song.artUrl ?? null,
        filePath: song.url,
        ext: song.ext,
        ...(song.cueStart != null ? { cueStart: song.cueStart, cueEnd: song.cueEnd } : {}),
      },
    } as unknown as LX.Music.MusicInfo,
  }
}

export interface SongPickerProps {
  visible: boolean
  listId: string
  listName: string
  /** 已在列表里的歌 id：用于显示「已加入」而不是隐藏 */
  existingIds?: string[]
  onClose: () => void
  onDone: (added: number) => void
}

export default ({ visible, listId, listName, existingIds, onClose, onDone }: SongPickerProps) => {
  const t = useI18n()
  const [all, setAll] = useState<PickSong[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [picked, setPicked] = useState<Record<string, PickSong>>({})
  const [status, setStatus] = useState('')

  const exists = useMemo(() => new Set(existingIds ?? []), [existingIds])

  useEffect(() => {
    if (!visible) return
    setPicked({})
    setKeyword('')
    setStatus('')
    let alive = true
    setLoading(true)
    void (async() => {
      const out: PickSong[] = []
      try {
        await ensureLoaded()
        out.push(...getSongs().map(fromLocal))
      } catch {}
      try {
        if (await isNasReachable()) {
          const idx = getNasIndex() ?? await restoreNasIndex()
          if (idx?.songs?.length) out.push(...idx.songs.map(fromNas))
        }
      } catch {}
      if (!alive) return
      setAll(out)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [visible])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return all
    return all.filter(s => s.name.toLowerCase().includes(k) || s.sub.toLowerCase().includes(k))
  }, [all, keyword])

  const pickedCount = Object.keys(picked).length

  const toggle = useCallback((item: PickSong) => {
    setPicked(prev => {
      const next = { ...prev }
      if (next[item.key]) delete next[item.key]
      else next[item.key] = item
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (pickedCount >= filtered.length && filtered.length) {
      setPicked({})
      return
    }
    const next: Record<string, PickSong> = {}
    filtered.forEach(s => { next[s.key] = s })
    setPicked(next)
  }, [filtered, pickedCount])

  const submit = useCallback(() => {
    const items = Object.values(picked)
    if (!items.length) return
    void addListMusics(listId, items.map(i => i.info), 'bottom').then(() => {
      onDone(items.length)
    }).catch((e: any) => {
      setStatus(String(e?.message ?? e))
    })
  }, [picked, listId, onDone])

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: MX.color.app }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 10 }}>
          <TouchableOpacity onPress={onClose} hitSlop={10} activeOpacity={0.7} style={{ padding: 4 }}>
            <IconBack size={20} color={MX.color.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text size={15} color={MX.color.text} numberOfLines={1}>{t('fav_pick_title', { name: listName })}</Text>
            <Text size={11} color={MX.color.text3} numberOfLines={1}>
              {pickedCount ? t('fav_pick_selected', { n: pickedCount }) : t('fav_pick_hint')}
            </Text>
          </View>
          <TouchableOpacity onPress={toggleAll} activeOpacity={0.7} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text size={12} color={MX.color.accent}>
              {pickedCount && pickedCount >= filtered.length ? t('fav_pick_clear') : t('fav_pick_all')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ paddingHorizontal: MX.space.page, paddingBottom: 8 }}>
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder={t('fav_pick_search')}
            placeholderTextColor={MX.color.text4}
            style={{
              backgroundColor: MX.color.card,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              color: MX.color.text,
              fontSize: 13,
            }}
          />
        </View>

        {loading
          ? <MxLoading text={t('fav_pick_loading')} />
          : filtered.length
            ? (
                <FlatList
                  data={filtered}
                  keyExtractor={s => s.key}
                  initialNumToRender={16}
                  windowSize={10}
                  maxToRenderPerBatch={12}
                  removeClippedSubviews
                  ListEmptyComponent={<View style={{ padding: 24 }}><Text size={12} color={MX.color.text3}>{t('fav_pick_empty')}</Text></View>}
                  renderItem={({ item }) => {
                    const on = !!picked[item.key]
                    const already = exists.has(item.info.id)
                    return (
                      <TouchableOpacity onPress={() => { toggle(item) }} activeOpacity={0.7}>
                        <View style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 10,
                          paddingHorizontal: MX.space.page,
                          paddingVertical: 10,
                          backgroundColor: on ? MX.color.accentDim : 'transparent',
                        }}>
                          <View style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            borderWidth: 1.4,
                            borderColor: on ? MX.color.accent : MX.color.line,
                            backgroundColor: on ? MX.color.accent : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            {on ? <IconCheck size={12} color="#0d0d0e" /> : null}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text size={13.5} color={on ? MX.color.accent : MX.color.text} numberOfLines={1}>{item.name}</Text>
                            <Text size={11} color={MX.color.text3} numberOfLines={1}>{item.sub || ' '}</Text>
                          </View>
                          {already ? <Text size={10.5} color={MX.color.text4}>{t('fav_pick_exist')}</Text> : null}
                        </View>
                      </TouchableOpacity>
                    )
                  }}
                />
              )
            : <View style={{ padding: 24 }}><Text size={12} color={MX.color.text3}>{t('fav_pick_empty')}</Text></View>}

        {status ? <Text size={11} color="#ff6b6b" style={{ paddingHorizontal: MX.space.page, paddingBottom: 6 }}>{status}</Text> : null}

        <View style={{ padding: MX.space.page, borderTopWidth: 1, borderTopColor: MX.color.line }}>
          <TouchableOpacity
            onPress={submit}
            activeOpacity={pickedCount ? 0.8 : 1}
            disabled={!pickedCount}
            style={{
              backgroundColor: pickedCount ? MX.color.accent : MX.color.card,
              borderRadius: 10,
              paddingVertical: 12,
              alignItems: 'center',
            }}>
            <Text size={13.5} color={pickedCount ? '#0d0d0e' : MX.color.text4}>
              {pickedCount ? t('fav_pick_add', { n: pickedCount }) : t('fav_pick_hint')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}
