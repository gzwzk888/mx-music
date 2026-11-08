/**
 * 家庭音乐共享 · 设备列表（阶段 A）
 * 只做一件事：自动扫描 + 卡片点选即连；复杂配置全部收进「高级」。
 */
import { FlatList, TouchableOpacity, View } from 'react-native'
import { useWindowSize } from '@/utils/hooks'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { useI18n } from '@/lang'
import { MxTopBar, MxEmpty } from '@/components/mx'
import { IconNas, IconScan, IconChevronRight } from '@/components/mx/Icons'

export interface HomeServer {
  name: string
  host: string
  /** 上次用过的服务器 */
  last?: boolean
}

interface Props {
  servers: HomeServer[]
  scanning: boolean
  /** 扫描过一轮没结果 */
  scanned: boolean
  message: string
  busy: boolean
  onScan: () => void
  onPick: (host: string) => void
  /** 长按卡片：从列表移除（清理失效/重复条目） */
  onLongPressDevice: (host: string) => void
  onAdvanced: () => void
}

const Dot = ({ on }: { on: boolean }) => (
  <View style={{
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: on ? MX.color.accent : MX.color.text4,
  }} />
)

export default ({ servers, scanning, scanned, message, busy, onScan, onPick, onLongPressDevice, onAdvanced }: Props) => {
  const t = useI18n()
  const { width } = useWindowSize()
  const wide = width >= 700
  return (
  <View style={{ flex: 1, backgroundColor: 'transparent' }}>
    <MxTopBar
      title={t('dev_title')}
      left={wide ? 'none' : 'menu'}
      onLeftPress={() => { global.app_event.changeMenuVisible(true) }}
      subtitle={scanning ? t('dev_scanning') : (servers.length ? t('dev_count', { n: servers.length }) : t('dev_hint'))}
      actions={[
        {
          key: 'scan',
          onPress: busy ? undefined : onScan,
          node: <IconScan size={MX.size.iconSm} color={scanning ? MX.color.accent : MX.color.iconIdle} />,
        },
        {
          key: 'more',
          onPress: onAdvanced,
          node: <IconChevronRight size={MX.size.iconSm} color={MX.color.iconIdle} />,
        },
      ]}
    />

    <FlatList
      data={servers}
      keyExtractor={s => s.host}
      contentContainerStyle={{ paddingBottom: 24 }}
      renderItem={({ item }) => (
        <TouchableOpacity
          activeOpacity={0.62}
          onPress={() => onPick(item.host)}
          onLongPress={() => onLongPressDevice(item.host)}
          delayLongPress={400}
          disabled={busy}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: MX.space.gap + 2,
            paddingHorizontal: MX.space.page,
            paddingVertical: 14,
            borderBottomWidth: 0.5,
            borderBottomColor: MX.color.line,
          }}
        >
          <View style={{
            width: 42,
            height: 42,
            borderRadius: MX.radius.card,
            backgroundColor: MX.color.circle,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <IconNas size={MX.size.icon} color={MX.color.text2} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text size={MX.font.section} color={MX.color.text} numberOfLines={1}>{item.name}</Text>
              {item.last ? <Text size={MX.font.caption} color={MX.color.accent}>{t('dev_last_used')}</Text> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Dot on={!!item.last} />
              <Text size={MX.font.rowSub} color={MX.color.text3} numberOfLines={1}>{item.host}</Text>
            </View>
          </View>
          <IconChevronRight size={MX.size.iconSm} color={MX.color.text4} />
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        scanning
          ? null
          : (
            <MxEmpty
              text={scanned
                ? t('dev_none')
                : t('dev_scan_hint')}
              action={
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  <TouchableOpacity
                    onPress={onScan}
                    disabled={busy}
                    style={{
                      paddingHorizontal: 16,
                      height: 34,
                      borderRadius: 17,
                      justifyContent: 'center',
                      backgroundColor: MX.color.accentDim,
                    }}
                  >
                    <Text size={MX.font.row} color={MX.color.accent}>{t('dev_rescan')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={onAdvanced}
                    style={{
                      paddingHorizontal: 16,
                      height: 34,
                      borderRadius: 17,
                      justifyContent: 'center',
                      backgroundColor: MX.color.circle,
                    }}
                  >
                    <Text size={MX.font.row} color={MX.color.text2}>{t('dev_manual_add')}</Text>
                  </TouchableOpacity>
                </View>
              }
            />
            )
      }
      ListFooterComponent={
        servers.length
          ? (
            <TouchableOpacity onPress={onAdvanced} style={{ paddingVertical: 18, alignItems: 'center' }}>
              <Text size={MX.font.rowSub} color={MX.color.text3}>{t('dev_manual_hint')}</Text>
            </TouchableOpacity>
            )
          : null
      }
    />

    {message
      ? (
        <View style={{ paddingHorizontal: MX.space.page, paddingBottom: 10 }}>
          <Text size={MX.font.rowSub} color={MX.color.text4} numberOfLines={2}>{message}</Text>
        </View>
        )
      : null}
  </View>
  )
}
