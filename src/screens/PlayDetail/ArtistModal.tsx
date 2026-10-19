import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import Image from '@/components/common/Image'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useWindowSize } from '@/utils/hooks'
import { usePlayMusicInfo } from '@/store/player/hook'
import { createStyle } from '@/utils/tools'
import { getArtistIntro, type ArtistLookup } from '@/core/nas/artistInfo'

const fmtNum = (n?: number) => {
  if (!n) return '0'
  const str = String(Math.round(n))
  let out = ''
  for (let i = 0; i < str.length; i++) {
    if (i > 0 && (str.length - i) % 3 === 0) out += ','
    out += str[i]
  }
  return out
}

/**
 * 艺人简介弹窗（含艺人头像）
 */
export default ({ visible, onClose }: { visible: boolean, onClose: () => void }) => {
  const theme = useTheme()
  const { height: winHeight } = useWindowSize()
  const playMusicInfo = usePlayMusicInfo()
  const musicInfo = (playMusicInfo?.musicInfo ?? {}) as any
  const singer = String(musicInfo?.singer ?? '').trim()
  const songTitle = String(musicInfo?.name ?? '').trim()

  const [result, setResult] = useState<ArtistLookup | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')

  useEffect(() => {
    if (!visible) return
    setResult(null)
    setState('loading')
    void getArtistIntro(singer, songTitle)
      .then(res => { setResult(res) })
      .catch(() => {})
      .finally(() => { setState('done') })
  }, [visible, singer, songTitle])

  const intro = result?.intro ?? null
  const picUrl = intro?.picUrl ? `${intro.picUrl}?param=300y300` : ''

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.mask} onPress={onClose}>
        <View style={{ ...styles.card, backgroundColor: theme['c-content-background'] }} onStartShouldSetResponder={() => true}>
          <View style={{ ...styles.header, borderBottomColor: theme['c-border-background'] }}>
            <Text size={16} color={theme['c-font']}>艺人简介</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={18} color={theme['c-350']} />
            </TouchableOpacity>
          </View>

          <ScrollView style={[styles.body, { maxHeight: Math.max(240, winHeight * 0.72) }]} contentContainerStyle={styles.bodyContent}>
            <View style={styles.artistRow}>
              {picUrl
                ? <Image url={picUrl} style={styles.avatar} />
                : <View style={{ ...styles.avatar, backgroundColor: theme['c-primary-alpha-200'], alignItems: 'center', justifyContent: 'center' }}>
                    <Text size={30} color={theme['c-primary']}>{(intro?.name ?? singer ?? '?').slice(0, 1)}</Text>
                  </View>
              }
              <View style={styles.artistMeta}>
                <Text size={19} color={theme['c-font']} numberOfLines={1}>{intro?.name ?? singer ?? '—'}</Text>
                {intro?.tags?.length
                  ? (
                    <View style={styles.tagRow}>
                      {intro.tags.map(t => (
                        <View key={t} style={{ ...styles.tag, borderColor: theme['c-300'] }}>
                          <Text size={11.5} color={theme['c-400']}>{t}</Text>
                        </View>
                      ))}
                    </View>
                    )
                  : null}
                {intro?.listeners
                  ? <Text style={styles.artistSub} size={12.5} color={theme['c-400']}>听众 {fmtNum(intro.listeners)}{intro.playcount ? ` · 播放 ${fmtNum(intro.playcount)}` : ''}</Text>
                  : null}
                {intro ? <Text style={styles.artistSub} size={12.5} color={theme['c-400']}>简介来源：{intro.source}</Text> : null}
              </View>
            </View>

            <View style={{ ...styles.divider, backgroundColor: theme['c-border-background'] }} />

            {state == 'loading'
              ? <Text size={13} color={theme['c-400']}>正在获取…</Text>
              : intro
                ? intro.sections.map((s, i) => (
                  <View key={i} style={styles.introBlock}>
                    {s.title ? <Text style={styles.introTitle} size={14.5} color={theme['c-primary']}>{s.title}</Text> : null}
                    <Text size={14} color={theme['c-350']} style={styles.introText}>{s.text}</Text>
                  </View>
                ))
                : <View>
                    <Text size={13} color={theme['c-400']}>{state == 'done' ? (result?.note ?? '没找到这位艺人的简介') : '—'}</Text>
                    {state == 'done' && result?.tried?.length
                      ? <Text style={styles.debug} size={11} color={theme['c-450']}>已尝试：{result.tried.join(' / ')}</Text>
                      : null}
                    {state == 'done' && !singer
                      ? <Text style={styles.debug} size={11} color={theme['c-450']}>这首歌没有艺人标签，可看「歌曲信息」里的路径确认文件</Text>
                      : null}
                  </View>
            }
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
    maxWidth: 760,
    maxHeight: '88%',
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
  bodyContent: { paddingHorizontal: 20, paddingVertical: 18 },
  artistRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  artistMeta: { flex: 1, paddingLeft: 18 },
  artistSub: { marginTop: 4 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 },
  tag: { borderWidth: 0.5, borderRadius: 3, paddingHorizontal: 7, paddingVertical: 2, marginRight: 6, marginBottom: 5 },
  divider: { height: 0.5, marginVertical: 12 },
  introBlock: { marginBottom: 16 },
  introTitle: { marginBottom: 3 },
  introText: { lineHeight: 22 },
  debug: { marginTop: 6 },
})
