import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Modal, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { useI18n } from '@/lang'
import { MxEmpty, MxIconButton, MxLoading, MxTopBar } from '@/components/mx'
import { IconBack, IconCheck, IconFolder } from '@/components/mx/Icons'
import { getExternalStoragePaths, readDir } from '@/utils/fs'
import { ensureAllFilesAccess } from '@/core/local/dirs'
import { androidVersion, hasAllFilesAccess } from '@/utils/nativeModules/mediaScan'

interface Entry {
  name: string
  path: string
}

interface Volume {
  /** 卷根目录，如 /storage/emulated/0、/storage/1A2B-3C4D */
  path: string
  name: string
}

/**
 * 目录浏览器（资源管理器式）：逐级进入子目录，把当前目录加入扫描列表
 *
 * 顶部可以切换存储卷（内部存储 / SD 卡 / U 盘），否则外置卡根本进不去。
 * 读目录失败（没给「所有文件访问」）时才提示去授权，不再一进来就挡死。
 */
export default ({ visible, onClose, onPick }: {
  visible: boolean
  onClose: () => void
  onPick: (path: string) => void
}) => {
  const t = useI18n()
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [granted, setGranted] = useState(true)
  /** 从子目录返回上级后，要定位到的那个子目录（“回到当前位置”而不是从头） */
  const [focusPath, setFocusPath] = useState('')
  const listRef = useRef<FlatList<Entry>>(null)
  const rowHRef = useRef(44)
  const listHRef = useRef(0)

  const load = useCallback(async(target: string) => {
    setLoading(true)
    setError('')
    try {
      const files = await readDir(target)
      const dirs = (files ?? [])
        .filter(f => f.isDirectory && !f.name.startsWith('.'))
        .map(f => ({ name: f.name, path: f.path }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
      setEntries(dirs)
      if (!dirs.length) setError(t('picker_no_subdir'))
    } catch (e: any) {
      setEntries([])
      setError(t('picker_fail', { msg: String(e?.message ?? e) }))
      // 大概率是没授权「所有文件访问」
      void hasAllFilesAccess().then(ok => { setGranted(ok) })
    } finally {
      setLoading(false)
    }
  }, [])

  /** 读取所有存储卷（内部存储 + 可移除卡） */
  const loadVolumes = useCallback(async(): Promise<Volume[]> => {
    const list: Volume[] = []
    try {
      const internal = await getExternalStoragePaths(false).catch(() => [] as string[])
      const removable = await getExternalStoragePaths(true).catch(() => [] as string[])
      for (const p of internal) {
        if (!p) continue
        list.push({ path: p.replace(/\/+$/, ''), name: t('picker_internal') })
      }
      if (!list.length) list.push({ path: '/storage/emulated/0', name: t('picker_internal') })
      for (const p of removable) {
        if (!p) continue
        const root = p.replace(/\/+$/, '')
        const tag = root.split('/').filter(Boolean).pop() ?? root
        list.push({ path: root, name: `${t('picker_sd')} ${tag}` })
      }
    } catch {}
    setVolumes(list)
    return list
  }, [])

  useEffect(() => {
    if (!visible) return
    void (async() => {
      // Android 11 以下没有「所有文件访问」：要的是运行时读取权限（车机 Android 10 走这条）
      let ok = await hasAllFilesAccess()
      if (!ok && androidVersion() < 30) ok = await ensureAllFilesAccess()
      setGranted(ok)
      const list = await loadVolumes()
      const root = list[0]?.path ?? '/storage/emulated/0'
      setPath(root)
      void load(root)
    })()
  }, [visible, load, loadVolumes])

  const goUp = () => {
    if (!path) return
    const parent = path.replace(/\/[^/]+\/?$/, '')
    if (!parent || parent == path) return
    // 记住刚从哪个子目录退出来，父目录列表加载完要滚到它那一行
    setFocusPath(path)
    setPath(parent)
    void load(parent)
  }

  // 返回上级后定位到刚才那个子目录（不在顶部）
  useEffect(() => {
    if (!focusPath) return
    const idx = entries.findIndex(e => e.path == focusPath)
    if (idx < 0) return // 列表还没换成父目录的内容，等下一次
    let tries = 0
    let timer: any = null
    const tick = () => {
      const ref = listRef.current
      if (ref) {
        ref.scrollToIndex({ index: idx, animated: false, viewPosition: 0.5 })
        setFocusPath('')
        return
      }
      if (++tries < 20) timer = setTimeout(tick, 50)
    }
    timer = setTimeout(tick, 30)
    return () => { if (timer) clearTimeout(timer) }
  }, [entries, focusPath])

  const shortPath = (p: string) => p.replace(/^\/storage\/emulated\/0/, t('picker_internal')).replace(/^\/storage\//, '存储/')
  /** 底部按钮里的目录名：根目录显示「内部存储」，其余取最后一段 */
  const pickName = (p: string) => {
    if (/^\/storage\/emulated\/0\/?$/.test(p)) return t('picker_internal')
    if (/^\/storage\/?$/.test(p)) return t('picker_storage')
    const hit = volumes.find(v => v.path == p)
    if (hit) return hit.name
    return p.split('/').filter(Boolean).pop() ?? p
  }

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: MX.color.app }}>
        <MxTopBar
          title={t('picker_title')}
          subtitle={path ? shortPath(path) : undefined}
          left="back"
          onLeftPress={onClose}
          actions={[{
            key: 'pick',
            node: <MxIconButton onPress={() => { onPick(path) }}><IconCheck size={19} color={MX.color.accent} /></MxIconButton>,
          }]}
        />

        {
          !granted
            ? (
                <View style={{ padding: 28, gap: 12, alignItems: 'center' }}>
                  <Text size={12.5} color={MX.color.text2} style={{ textAlign: 'center', lineHeight: 19 }}>
                    {t('picker_need_perm')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => { void ensureAllFilesAccess() }}
                    activeOpacity={0.8}
                    style={{ backgroundColor: MX.color.accentDim, borderColor: MX.color.accent, borderWidth: 1, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 }}>
                    <Text size={13} color={MX.color.accent}>{t('picker_grant')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { void (async() => { const ok = await hasAllFilesAccess(); setGranted(ok); if (ok) void load(path) })() }}
                    activeOpacity={0.7}>
                    <Text size={12} color={MX.color.text3}>{t('picker_granted')}</Text>
                  </TouchableOpacity>
                </View>
              )
            : null
        }

        {/* 存储卷切换：内部存储 / SD 卡 */}
        {volumes.length > 1
          ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: MX.space.page, paddingBottom: 8 }}>
                {volumes.map(v => (
                  <TouchableOpacity
                    key={v.path}
                    activeOpacity={0.75}
                    onPress={() => { setPath(v.path); void load(v.path) }}
                    style={{
                      borderWidth: 1,
                      borderColor: path.startsWith(v.path) ? MX.color.accent : MX.color.line,
                      backgroundColor: path.startsWith(v.path) ? MX.color.accentDim : 'transparent',
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      paddingVertical: 5,
                    }}>
                    <Text size={11.5} color={path.startsWith(v.path) ? MX.color.accent : MX.color.text2}>{v.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )
          : null
        }

        <View style={{ flex: 1 }}>
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: MX.space.page,
            paddingVertical: 6,
            borderBottomWidth: 1,
            borderBottomColor: MX.color.line,
          }}>
            <TouchableOpacity onPress={goUp} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <IconBack size={15} color={MX.color.text2} />
              <Text size={12} color={MX.color.text2}>{t('picker_parent')}</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <Text size={11} color={MX.color.text4} numberOfLines={1} style={{ maxWidth: '62%' }}>{shortPath(path)}</Text>
          </View>

          {loading
            ? <MxLoading text={t('picker_reading')} />
            : (
                <FlatList
                  ref={listRef}
                  data={entries}
                  keyExtractor={e => e.path}
                  onLayout={e => { listHRef.current = e.nativeEvent.layout.height }}
                  getItemLayout={(_, i) => ({ length: rowHRef.current, offset: rowHRef.current * i, index: i })}
                  onScrollToIndexFailed={info => {
                    listRef.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: false })
                    setTimeout(() => {
                      listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.5 })
                    }, 120)
                  }}
                  renderItem={({ item }) => (
                    <TouchableOpacity activeOpacity={0.65} onPress={() => { setPath(item.path); void load(item.path) }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: MX.space.page, paddingVertical: 13 }} onLayout={e => { const h = e.nativeEvent.layout.height; if (h > 0) rowHRef.current = h }}>
                        <IconFolder size={19} color={MX.color.text2} />
                        <Text size={13} color={MX.color.text} numberOfLines={1} style={{ flex: 1 }}>{item.name}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={<MxEmpty text={error || t('picker_empty_dir')} />}
                />
              )}

          <TouchableOpacity activeOpacity={0.85} onPress={() => { onPick(path) }}>
            <View style={{
              margin: 14,
              paddingVertical: 13,
              borderRadius: 999,
              alignItems: 'center',
              backgroundColor: MX.color.accent,
            }}>
              <Text size={14} color="#08121c" >{t('picker_add_path', { name: pickName(path) })}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}
