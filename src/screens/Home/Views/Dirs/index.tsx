import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { useI18n } from '@/lang'
import { MxEmpty, MxIconButton, MxTopBar } from '@/components/mx'
import { IconClose, IconFolder, IconPlus, IconScan } from '@/components/mx/Icons'
import { useNavActiveId } from '@/store/common/hook'
import { useWindowSize } from '@/utils/hooks'
import { confirmDialog } from '@/utils/tools'
import { androidVersion, hasAllFilesAccess, openAllFilesSettings } from '@/utils/nativeModules/mediaScan'
import {
  addDir, ensureAllFilesAccess, ensureLoaded, getDirs, getSongs, removeDir, scanAll,
  type LocalDir,
} from '@/core/local/dirs'
import DirPicker from '../Library/DirPicker'

interface Row extends LocalDir { count: number }

/** 音乐目录：只管「添加/删除目录 + 重新扫描」，歌曲列表在音乐库看 */
export default () => {
  const t = useI18n()
  const navActiveId = useNavActiveId()
  const active = navActiveId == 'nav_dirs'
  const { width } = useWindowSize()
  const wide = width >= 700

  const [rows, setRows] = useState<Row[]>([])
  const [scanText, setScanText] = useState('')
  const [status, setStatus] = useState('')
  const [pickerVisible, setPickerVisible] = useState(false)
  const restoredRef = useRef(false)

  const reload = useCallback(async() => {
    await ensureLoaded()
    const songs = getSongs()
    setRows(getDirs().map(d => ({
      ...d,
      count: songs.filter(s => s.dir == d.path).length,
    })))
  }, [])

  const rescan = useCallback(async() => {
    // Android 11+ 必须先给「所有文件访问」，Android 10 及以下是运行时读取权限
    if (!(await hasAllFilesAccess())) {
      setStatus(t('dirs_need_perm'))
      if (await ensureAllFilesAccess()) {
        // 车机（Android 10）弹窗里当场同意，继续往下扫
      } else if (!(await hasAllFilesAccess())) {
        return
      }
    }
    setScanText(t('dirs_rescan_clearing'))
    try {
      // 「重新扫描」= 清空旧索引重来（旧索引里的风格/封面字段不再可信）
      const res = await scanAll(p => { setScanText(p.text) }, { force: true })
      await reload()
      setStatus(t('dirs_scan_done', { n: res.total, a: res.added, u: res.updated }))
    } catch (e: any) {
      setStatus(t('dirs_scan_fail', { msg: String(e?.message ?? e) }))
    } finally {
      setScanText('')
    }
  }, [reload])

  useEffect(() => {
    if (!active || restoredRef.current) return
    restoredRef.current = true
    void reload()
  }, [active, reload])

  return (
    <View style={{ flex: 1, backgroundColor: MX.color.app }}>
      <MxTopBar
        title={t('nav_dirs')}
        subtitle={scanText || status || t('dirs_summary', { n: rows.length, m: rows.reduce((n, r) => n + r.count, 0) })}
        left={wide ? 'none' : 'menu'}
        onLeftPress={() => { global.app_event.changeMenuVisible(true) }}
        actions={[
          {
            key: 'scan',
            node: <MxIconButton onPress={() => { void rescan() }}><IconScan size={18} color={scanText ? MX.color.accent : MX.color.text} /></MxIconButton>,
          },
        ]}
      />

      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: MX.space.page,
        paddingTop: 10,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: MX.color.line,
      }}>
        <TouchableOpacity onPress={() => { setPickerVisible(true) }} activeOpacity={0.75}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: MX.color.accentDim, borderWidth: 1, borderColor: MX.color.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
          <IconPlus size={14} color={MX.color.accent} />
          <Text size={12} color={MX.color.accent}>{t('dirs_add')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { void rescan() }} activeOpacity={0.75}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: MX.color.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
          <IconScan size={14} color={MX.color.text2} />
          <Text size={12} color={MX.color.text2}>{t('dirs_rescan')}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <Text size={10.5} color={MX.color.text4}>{t('dirs_auto_rescan')}</Text>
      </View>

      {
        rows.length
          ? (
              <FlatList
                data={rows}
                keyExtractor={r => r.path}
                renderItem={({ item }) => (
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingHorizontal: MX.space.page,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: MX.color.lineSoft,
                  }}>
                    <IconFolder size={20} color={MX.color.accent} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text size={13} color={MX.color.text} numberOfLines={1}>{item.name}</Text>
                      <Text size={10.5} color={MX.color.text4} numberOfLines={1} style={{ marginTop: 2 }}>{item.path}</Text>
                    </View>
                    <Text size={11} color={MX.color.text3}>{t('dirs_song_count', { n: item.count })}</Text>
                    <TouchableOpacity
                      onPress={() => {
                        void confirmDialog({
                          message: t('dirs_remove_confirm', { name: item.name, n: item.count }),
                          confirmButtonText: t('dirs_remove'),
                        }).then(ok => {
                          if (!ok) return
                          void (async() => {
                            await removeDir(item.path)
                            await reload()
                            setStatus(t('dirs_removed', { name: item.name, n: item.count }))
                          })()
                        })
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.7}>
                      <IconClose size={16} color={MX.color.text4} />
                    </TouchableOpacity>
                  </View>
                )}
              />
            )
          : (
              <MxEmpty
                text={t('dirs_empty')}
                action={
                  <TouchableOpacity onPress={() => { setPickerVisible(true) }} activeOpacity={0.8}>
                    <View style={{ borderWidth: 1, borderColor: MX.color.accent, backgroundColor: MX.color.accentDim, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 }}>
                      <Text size={12.5} color={MX.color.accent}>{t('dirs_choose_folder')}</Text>
                    </View>
                  </TouchableOpacity>
                }
              />
            )
      }

      <DirPicker
        visible={pickerVisible}
        onClose={() => { setPickerVisible(false) }}
        onPick={(path) => {
          setPickerVisible(false)
          void (async() => {
            const added = await addDir(path)
            await reload()
            if (!added) {
              setStatus(t('dirs_dup'))
              return
            }
            setStatus(t('dirs_added', { path }))
            void rescan()
          })()
        }}
      />
    </View>
  )
}
