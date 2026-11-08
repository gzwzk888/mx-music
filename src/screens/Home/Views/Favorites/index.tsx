import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FlatList, Modal, ScrollView, TextInput, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { confirmDialog } from '@/utils/tools'
import { useI18n, getMessage } from '@/lang'
import { MxActionSheet, MxEmpty, MxIconButton, MxLoading, MxSongRow, MxTopBar, type MxActionItem } from '@/components/mx'
import { IconBack, IconChevronDown, IconHeart, IconNas, IconPlay, IconPlus, IconSearch, IconShuffle } from '@/components/mx/Icons'
import SongPicker from './SongPicker'
import { useNavActiveId } from '@/store/common/hook'
import { setNavActiveId } from '@/core/common'
import { useMyList } from '@/store/list/hook'
import { useWindowSize } from '@/utils/hooks'
import { createList, getListMusics, removeListMusics, removeUserList } from '@/core/list'
import { playInTempList } from '@/core/nas/playHelper'
import { getNasSession } from '@/core/nas/session'
import { ensureLoaded, getSongs, type LocalSong } from '@/core/local/dirs'
import { listNasPlaylists, type NasPlaylistInfo } from '@/core/nas/nasPlaylists'
import { browse, applyCueRanges, toMusicInfo } from '@/core/nas/dlna'
import { LIST_IDS } from '@/config/constant'

interface Row { id: string, name: string, sub?: string, count?: number }

const MAX_INLINE = 30

const toLocalInfo = (m: LX.Music.MusicInfo): LX.Music.MusicInfoLocal => m as LX.Music.MusicInfoLocal

/**
 * 早期从播放页「添加到列表」加进来的条目只有 id/name/singer 这类基础字段，
 * 缺 meta.filePath —— 播不出来、也没封面。这里按 id 回本机索引把 meta 补齐（只补内存，不改写列表数据）。
 */
const hydrateSongs = async(songs: LX.Music.MusicInfo[]): Promise<LX.Music.MusicInfo[]> => {
  if (!songs.length) return songs
  if (songs.every(m => !!(m.meta as any)?.filePath)) return songs
  let index: Map<string, LocalSong>
  try {
    await ensureLoaded()
    index = new Map(getSongs().map(s => [`local_${s.path}`, s]))
  } catch {
    return songs
  }
  return songs.map(m => {
    if ((m.meta as any)?.filePath) return m
    const hit = index.get(m.id)
    if (!hit) return m
    const ext = (/\.([a-z0-9]{2,5})$/i.exec(hit.path)?.[1] ?? '').toLowerCase()
    return { ...m, meta: { ...(m.meta ?? {}), songId: hit.path, filePath: hit.path, ext } } as LX.Music.MusicInfo
  })
}

/**
 * 我的最爱：三段固定顺序、每次进入都从第 1 段开始展开，不记忆上次操作
 *   ① 我的最爱（心型） ② 本机播放列表 ③ NAS 播放列表
 */
const Favorites = () => {
  const t = useI18n()
  const navActiveId = useNavActiveId()
  const { width } = useWindowSize()
  const wide = width >= 700
  const active = navActiveId == 'nav_love'
  const lists = useMyList()

  const [nasLists, setNasLists] = useState<NasPlaylistInfo[]>([])

  const loveList = lists.find(l => l.id == LIST_IDS.LOVE)
  // NAS 同步出来的列表归第三段，不算本机列表：
  //   ① id 前缀 userlist_nas_（本版） ② 旧版名字以 NAS· 开头 ③ 名字与 NAS 服务器上的播放列表同名
  const userLists = lists.filter(l => l.id != LIST_IDS.LOVE && l.id != LIST_IDS.DEFAULT && l.id != LIST_IDS.TEMP &&
    !l.id.startsWith('userlist_nas_') && !l.name.startsWith('NAS·') &&
    !(l.name && nasLists.some(p => p.title == l.name)))

  const [loveSongs, setLoveSongs] = useState<LX.Music.MusicInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [drill, setDrill] = useState<{ title: string, songs: LX.Music.MusicInfo[], sub?: string, listId?: string } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sheetFor, setSheetFor] = useState<{ title: string, items: MxActionItem[] } | null>(null)
  const [creating, setCreating] = useState(false)
  /** 各段折叠状态：我的最爱默认收起（曲目多时会把后面的段落顶出屏幕） */
  const [open, setOpen] = useState({ love: false, local: true, nas: true })
  const [newName, setNewName] = useState('')

  const loadLove = useCallback(async() => {
    const songs = await getListMusics(LIST_IDS.LOVE).catch(() => [])
    setLoveSongs(await hydrateSongs(songs ?? []))
  }, [])

  const loadNas = useCallback(async() => {
    const dev = getNasSession().device
    if (!dev) {
      setNasLists([])
      return
    }
    try {
      const { lists: nas } = await listNasPlaylists(dev)
      setNasLists(nas.filter(l => l.count > 0))
    } catch {
      setNasLists([])
    }
  }, [])

  const DEFAULT_OPEN = { love: false, local: true, nas: true }

  const refresh = useCallback(async() => {
    setLoading(true)
    await Promise.all([loadLove(), loadNas()])
    setLoading(false)
  }, [loadLove, loadNas])

  /** 回到初始态：退出子列表 + 我的收藏收起 + 两个列表段展开 + 重新读数据 */
  const resetToDefault = useCallback(() => {
    setDrill(null)
    setOpen(DEFAULT_OPEN)
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!active) return
    resetToDefault()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // 重复点侧栏「我的最爱」＝回到初始态（否则看到的是上次的展开/子列表）
  useEffect(() => {
    const handleRetap = (id: string) => {
      if (id !== 'nav_love') return
      resetToDefault()
    }
    global.state_event.on('navActiveIdReTapped', handleRetap)
    return () => {
      global.state_event.off('navActiveIdReTapped', handleRetap)
    }
  }, [resetToDefault])

  const playSongs = useCallback((songs: LX.Music.MusicInfo[], target?: LX.Music.MusicInfo) => {
    const infos = songs.map(toLocalInfo).filter(m => !!m.meta?.filePath)
    if (!infos.length) {
      setStatus(t('fav_no_playable'))
      return
    }
    void playInTempList(infos, (target?.id ?? infos[0].id))
  }, [])

  /** 随机播放：打乱后进临时列表，从第一首开始 */
  const playShuffle = useCallback((songs: LX.Music.MusicInfo[]) => {
    const infos = songs.map(toLocalInfo).filter(m => !!m.meta?.filePath)
    if (!infos.length) {
      setStatus(t('fav_no_playable'))
      return
    }
    const shuffled = [...infos]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = tmp
    }
    void playInTempList(shuffled, shuffled[0].id)
  }, [])

  const openUserList = useCallback(async(row: Row) => {
    setLoading(true)
    const songs = await getListMusics(row.id).catch(() => [])
    const fixed = await hydrateSongs(songs ?? [])
    setLoading(false)
    setDrill({ title: row.name, sub: `${fixed.length} 首`, songs: fixed, listId: row.id })
  }, [])

  /** 从列表里移除歌曲（NAS 播放列表是只读拉取的，不走这里） */
  const removeSongs = useCallback((listId: string, items: LX.Music.MusicInfo[]) => {
    const ids = items.map(m => m.id)
    void removeListMusics(listId, ids).then(() => {
      setStatus(t('fav_removed', { name: items[0]?.name ?? '' }))
      if (listId === LIST_IDS.LOVE) void loadLove()
      setDrill(d => (d && d.listId === listId)
        ? {
            ...d,
            songs: d.songs.filter(m => !ids.includes(m.id)),
            sub: t('fav_count_songs', { n: Math.max(0, d.songs.length - ids.length) }),
          }
        : d)
    }).catch((e: any) => {
      setStatus(t('fav_remove_fail', { msg: String(e?.message ?? e) }))
    })
  }, [loadLove])

  /** 删除整个本机播放列表（连着列表里的歌一起删） */
  const removeList = useCallback(async(id: string, name: string) => {
    const ok = await confirmDialog({ message: t('fav_remove_list_confirm', { name }) })
    if (!ok) return
    try {
      await removeUserList([id])
      setStatus(t('fav_list_removed', { name }))
      setDrill(d => (d && d.listId === id ? null : d))
      void refresh()
    } catch (e: any) {
      setStatus(t('fav_remove_fail', { msg: String(e?.message ?? e) }))
    }
  }, [refresh, t])

  const openNasList = useCallback(async(pl: NasPlaylistInfo) => {
    const dev = getNasSession().device
    if (!dev) {
      setStatus(t('fav_nas_offline'))
      return
    }
    setLoading(true)
    setStatus(t('fav_reading_pl', { name: pl.title }))
    try {
      const { items } = await browse(dev, pl.id, 0, 500)
      const songs = applyCueRanges(items).filter(it => !it.isContainer && it.url).map(toMusicInfo)
      setDrill({ title: pl.title, sub: `${songs.length} 首 · NAS`, songs })
      setStatus('')
    } catch (e: any) {
      setStatus(t('fav_read_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setLoading(false)
    }
  }, [])

  const songRow = (list: LX.Music.MusicInfo[], listId?: string) => ({ item }: { item: LX.Music.MusicInfo }) => (
    <MxSongRow
      art={item.meta?.picUrl ?? null}
      coverPath={item.source === 'local' ? item.meta?.filePath : undefined}
      title={item.name}
      sub={[item.singer, (item.meta as any)?.albumName].filter(Boolean).join(' · ') || undefined}
      duration={item.interval ?? undefined}
      badge={(item.meta as any)?.ext ? String((item.meta as any).ext).toUpperCase() : undefined}
      onPress={() => { playSongs(list, item) }}
      onMore={() => {
        setSheetFor({
          title: item.name,
          items: [
            {
              key: 'play',
              label: t('lib_play'),
              onPress: () => { playSongs(list, item) },
            },
            // 有 listId 才给删除：NAS 播放列表是只读拉取的，删不了
            ...(listId
              ? [{
                  key: 'remove',
                  label: t('fav_remove_song'),
                  danger: true,
                  onPress: () => { removeSongs(listId, [item]) },
                }]
              : []),
          ],
        })
      }}
    />
  )

  const header = (
    <MxTopBar
      title={drill ? drill.title : t('nav_love')}
      subtitle={drill ? drill.sub : status || undefined}
      left={drill ? 'back' : (wide ? 'none' : 'menu')}
      onLeftPress={() => {
        if (drill) {
          setDrill(null)
          return
        }
        global.app_event.changeMenuVisible(true)
      }}
      actions={[
        // 外壳顶栏在这一页不再渲染（否则标题出现两次），搜索入口搬到这里
        ...(drill
          ? []
          : [{
              key: 'search',
              node: <MxIconButton onPress={() => { setNavActiveId('nav_search') }}><IconSearch size={18} color={MX.color.text} /></MxIconButton>,
            }]),
        {
          key: 'new',
          node: <MxIconButton onPress={() => { setNewName(''); setCreating(true) }}><IconPlus size={18} color={MX.color.text} /></MxIconButton>,
        },
      ]}
    />
  )

  const SectionHead = ({ id, label, count }: { id: 'love' | 'local' | 'nas', label: string, count: string }) => {
    const expanded = open[id]
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={() => { setOpen(o => ({ ...o, [id]: !o[id] })) }}>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: MX.space.page,
          paddingTop: 16,
          paddingBottom: 10,
        }}>
          <View style={{ transform: [{ rotate: expanded ? '0deg' : '-90deg' }] }}>
            <IconChevronDown size={16} color={MX.color.text3} />
          </View>
          <Text size={MX.font.section} color={MX.color.text} style={{ letterSpacing: 0.5, flex: 1 }}>{label}</Text>
          <Text size={12} color={MX.color.text3}>{count}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  const ActionPill = ({ icon, label, onPress }: { icon: ReactNode, label: string, onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: MX.color.accentDim, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
      {icon}
      <Text size={12} color={MX.color.accent}>{label}</Text>
    </TouchableOpacity>
  )

  let body: ReactNode
  if (loading) {
    body = <MxLoading text={t('fav_reading')} />
  } else if (drill) {
    body = (
      <FlatList
        data={drill.songs}
        keyExtractor={m => m.id}
        renderItem={songRow(drill.songs, drill.listId)}
        ListHeaderComponent={(drill.songs.length || drill.listId)
          ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: MX.space.page, paddingVertical: 10 }}>
                {drill.songs.length
                  ? (
                      <>
                        <ActionPill
                          icon={<IconPlay size={14} color={MX.color.accent} />}
                          label={t('lib_play_all')}
                          onPress={() => { playSongs(drill.songs, drill.songs[0]) }} />
                        <ActionPill
                          icon={<IconShuffle size={14} color={MX.color.accent} />}
                          label={t('fav_play_shuffle')}
                          onPress={() => { playShuffle(drill.songs) }} />
                      </>
                    )
                  : null}
                {drill.listId
                  ? (
                      <TouchableOpacity onPress={() => { setPickerOpen(true) }} activeOpacity={0.7}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: MX.color.line, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
                        <IconPlus size={13} color={MX.color.text2} />
                        <Text size={12} color={MX.color.text2}>{t('fav_add_songs')}</Text>
                      </TouchableOpacity>
                    )
                  : null}
              </View>
            )
          : null}
        ListEmptyComponent={<MxEmpty text={t('fav_empty_list')} />}
      />
    )
  } else {
    body = (
      <ScrollView style={{ flex: 1 }}>
        {/* ① 我的收藏（默认收起：曲子多时会把后面两段顶出屏幕） */}
        <SectionHead id="love" label={t('fav_my_love')} count={loveSongs.length ? t('fav_count_songs', { n: loveSongs.length }) : t('fav_empty_flag')} />
        {
          open.love && (loveSongs.length
            ? (
                <View>
                  {/* 我的收藏段：整段播放 / 随机播放（原来只能逐首点） */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: MX.space.page, paddingBottom: 8 }}>
                    <ActionPill
                      icon={<IconPlay size={14} color={MX.color.accent} />}
                      label={t('lib_play_all')}
                      onPress={() => { playSongs(loveSongs, loveSongs[0]) }} />
                    <ActionPill
                      icon={<IconShuffle size={14} color={MX.color.accent} />}
                      label={t('fav_play_shuffle')}
                      onPress={() => { playShuffle(loveSongs) }} />
                  </View>
                  {loveSongs.slice(0, MAX_INLINE).map(item => (
                    <View key={item.id}>
                      {songRow(loveSongs, LIST_IDS.LOVE)({ item })}
                    </View>
                  ))}
                  {loveSongs.length > MAX_INLINE
                    ? (
                        <TouchableOpacity onPress={() => { setDrill({ title: t('fav_my_love'), sub: t('fav_count_songs', { n: loveSongs.length }), songs: loveSongs, listId: LIST_IDS.LOVE }) }} activeOpacity={0.7}>
                          <View style={{ paddingHorizontal: MX.space.page, paddingVertical: 10 }}>
                            <Text size={12} color={MX.color.accent}>查看全部 {loveSongs.length} 首</Text>
                          </View>
                        </TouchableOpacity>
                      )
                    : null}
                </View>
              )
            : (
                <View style={{ paddingHorizontal: MX.space.page, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <IconHeart size={16} color={MX.color.text4} />
                  <Text size={12} color={MX.color.text3} style={{ flex: 1 }}>{t('fav_empty_love')}</Text>
                </View>
              ))
        }

        {/* ② 本机播放列表 */}
        <SectionHead id="local" label={t('fav_local_lists')} count={userLists.length ? t('fav_count_items', { n: userLists.length }) : t('fav_empty_flag')} />
        {
          open.local && (userLists.length
            ? userLists.map(l => (
                <MxSongRow
                  key={l.id}
                  art={null}
                  title={l.name}
                  sub={t('fav_local_list_sub')}
                  onPress={() => { void openUserList({ id: l.id, name: l.name }) }}
                  onMore={() => {
                    setSheetFor({
                      title: l.name,
                      items: [
                        { key: 'open', label: t('fav_open'), onPress: () => { void openUserList({ id: l.id, name: l.name }) } },
                        { key: 'remove-list', label: t('fav_remove_list'), danger: true, onPress: () => { void removeList(l.id, l.name) } },
                      ],
                    })
                  }}
                />
              ))
            : (
                <TouchableOpacity onPress={() => { setNewName(''); setCreating(true) }} activeOpacity={0.75}>
                  <View style={{ marginHorizontal: MX.space.page, borderWidth: 1, borderStyle: 'dashed', borderColor: MX.color.line, borderRadius: 8, paddingVertical: 13, alignItems: 'center' }}>
                    <Text size={12} color={MX.color.text3}>{t('fav_empty_playlist')}</Text>
                  </View>
                </TouchableOpacity>
              ))
        }

        {/* ③ NAS 播放列表 */}
        <SectionHead id="nas" label={t('fav_nas_lists')} count={nasLists.length ? t('fav_count_items', { n: nasLists.length }) : '—'} />
        {
          open.nas && (nasLists.length
            ? nasLists.map(pl => (
                <MxSongRow
                  key={pl.id}
                  art={null}
                  title={pl.title}
                  sub={`NAS · ${pl.count} 首`}
                  badge="NAS"
                  onPress={() => { void openNasList(pl) }}
                />
              ))
            : (
                <View style={{ paddingHorizontal: MX.space.page, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <IconNas size={16} color={MX.color.text4} />
                  <Text size={12} color={MX.color.text3}>{getNasSession().device ? t('fav_no_nas_list') : t('fav_nas_offline')}</Text>
                </View>
              ))
        }

        <View style={{ height: 24 }} />
      </ScrollView>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: MX.color.app }}>
      {header}
      <View style={{ flex: 1 }}>{body}</View>

      <MxActionSheet
        visible={!!sheetFor}
        title={sheetFor?.title}
        items={sheetFor?.items ?? []}
        onClose={() => { setSheetFor(null) }}
      />

      <SongPicker
        visible={pickerOpen}
        listId={drill?.listId ?? ''}
        listName={drill?.title ?? ''}
        existingIds={drill?.songs.map(m => m.id)}
        onClose={() => { setPickerOpen(false) }}
        onDone={(n) => {
          setPickerOpen(false)
          setStatus(t('fav_pick_added', { n }))
          const id = drill?.listId
          if (!id) return
          void getListMusics(id).then(list => {
            setDrill(d => (d && d.listId === id)
              ? { ...d, songs: list ?? [], sub: t('fav_count_songs', { n: list?.length ?? 0 }) }
              : d)
          })
          if (id === LIST_IDS.LOVE) void loadLove()
        }}
      />

      <Modal visible={creating} transparent animationType="fade" onRequestClose={() => { setCreating(false) }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 360, backgroundColor: MX.color.panel, borderRadius: 10, padding: 18, borderWidth: 1, borderColor: MX.color.line }}>
            <Text size={14} color={MX.color.text}>{t('fav_new_list')}</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder={t('fav_list_name')}
              placeholderTextColor={MX.color.text4}
              autoFocus
              style={{
                marginTop: 12,
                backgroundColor: MX.color.card,
                borderRadius: 6,
                paddingHorizontal: 12,
                paddingVertical: 9,
                color: MX.color.text,
                fontSize: 13,
              }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 16 }}>
              <TouchableOpacity onPress={() => { setCreating(false) }} activeOpacity={0.7}>
                <Text size={13} color={MX.color.text3}>{t('fav_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const name = newName.trim() || t('fav_new_list_default', { n: userLists.length + 1 })
                  setCreating(false)
                  void createList({ name, list: [], position: -1 }).then(() => {
                    setStatus(t('fav_created', { name }))
                  }).catch((e: any) => { setStatus(t('fav_create_fail', { msg: String(e?.message ?? e) })) })
                }}
                activeOpacity={0.7}>
                <Text size={13} color={MX.color.accent}>{t('fav_create')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

export default Favorites
