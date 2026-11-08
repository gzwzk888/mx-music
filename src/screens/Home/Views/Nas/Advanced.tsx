/**
 * 家庭音乐共享 · 高级
 * 手动地址、SMB 账号（只为读 .cue）、索引与播放列表维护、忘记设备。
 * 这里的东西全部是「偶发使用」，主路径不依赖。
 */
import { useEffect, useState } from 'react'
import { ScrollView, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native'
import Text from '@/components/common/Text'
import { MX } from '@/theme/mx'
import { useI18n } from '@/lang'
import { MxTopBar } from '@/components/mx'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'

interface Props {
  deviceName: string
  host: string
  onManualConnect: (host: string) => void

  smbUser: string
  smbPass: string
  smbShare: string
  setSmbUser: (v: string) => void
  setSmbPass: (v: string) => void
  setSmbShare: (v: string) => void
  smbSaved: boolean
  smbVerifying: boolean
  onSaveSmb: () => void

  indexing: boolean
  indexMsg: string
  indexInfo: string
  onRebuildIndex: () => void
  onScanCovers: () => void
  onCancelIndex: () => void
  onScanCue: () => void
  onReloadPlaylists: () => void
  onForget: () => void

  message: string
  onBack: () => void
}

const inputStyle = {
  height: 42,
  borderWidth: 1,
  borderColor: MX.color.line,
  borderRadius: MX.radius.card,
  paddingHorizontal: 12,
  color: MX.color.text,
  backgroundColor: MX.color.panel,
  fontSize: MX.font.row,
} as const

const Section = ({ title, hint, children }: { title: string, hint?: string, children: React.ReactNode }) => (
  <View style={{ marginTop: 22 }}>
    <Text size={MX.font.caption} color={MX.color.text4} style={{ letterSpacing: 1.2 }}>{title.toUpperCase()}</Text>
    {hint ? <Text size={MX.font.caption} color={MX.color.text4} style={{ marginTop: 4, lineHeight: 15 }}>{hint}</Text> : null}
    <View style={{ marginTop: 10, gap: 10 }}>{children}</View>
  </View>
)

const Btn = ({ text, onPress, tone = 'plain', disabled, busy }: {
  text: string
  onPress: () => void
  tone?: 'accent' | 'plain' | 'danger'
  disabled?: boolean
  busy?: boolean
}) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.7}
    style={{
      height: 42,
      borderRadius: MX.radius.card,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      backgroundColor: tone == 'accent' ? MX.color.accent : MX.color.circle,
      opacity: disabled ? 0.45 : 1,
    }}
  >
    {busy ? <ActivityIndicator size="small" color={tone == 'accent' ? '#08131f' : MX.color.text2} /> : null}
    <Text size={MX.font.row} color={tone == 'accent' ? '#08131f' : (tone == 'danger' ? '#e0574b' : MX.color.text2)}>{text}</Text>
  </TouchableOpacity>
)

export default (p: Props) => {
  const t = useI18n()
  const autoDays = useSettingValue('nas.autoRebuildDays')
  const cycleAutoRebuild = () => {
    const order = [3, 7, 1, 0]
    const next = order[(order.indexOf(Number(autoDays) || 3) + 1) % order.length]
    updateSetting({ 'nas.autoRebuildDays': next })
  }
  const [manual, setManual] = useState(p.host)
  useEffect(() => { if (p.host && p.host != manual) setManual(p.host) }, [p.host])
  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <MxTopBar title={t('adv_title')} left="back" onLeftPress={p.onBack} subtitle={p.deviceName || t('nas_disconnected')} />
      <ScrollView contentContainerStyle={{ padding: MX.space.page, paddingBottom: 40 }}>
        <Section title={t('dev_manual_add')} hint={t('adv_manual_hint')}>
          <TextInput
            style={inputStyle}
            value={manual}
            placeholder={t('adv_addr_ph')}
            placeholderTextColor={MX.color.text4}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setManual}
            onSubmitEditing={() => p.onManualConnect(manual)}
          />
          <Btn text={p.deviceName ? t('adv_reconnect', { name: p.deviceName }) : t('adv_connect')} tone="accent" onPress={() => p.onManualConnect(manual)} />
        </Section>

        <Section
          title={t('adv_smb_title')}
          hint={t('adv_smb_desc')}
        >
          <TextInput
            style={inputStyle}
            value={p.smbUser}
            onChangeText={p.setSmbUser}
            placeholder={t('adv_user')}
            placeholderTextColor={MX.color.text4}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={inputStyle}
            value={p.smbPass}
            onChangeText={p.setSmbPass}
            placeholder={t('adv_pass')}
            placeholderTextColor={MX.color.text4}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={inputStyle}
            value={p.smbShare}
            onChangeText={p.setSmbShare}
            placeholder={t('adv_share_ph')}
            placeholderTextColor={MX.color.text4}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Btn
            text={p.smbVerifying ? t('adv_verifying') : (p.smbSaved ? t('adv_verified') : t('adv_verify_save'))}
            onPress={p.onSaveSmb}
            busy={p.smbVerifying}
            disabled={p.smbVerifying}
          />
        </Section>

        <Section title={t('adv_data_title')} hint={p.indexInfo || t('adv_data_desc')}>
          {p.indexing
            ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator size="small" color={MX.color.accent} />
                <Text size={MX.font.rowSub} color={MX.color.accent} numberOfLines={1} style={{ flex: 1 }}>{p.indexMsg || t('adv_running')}</Text>
                <Btn text={t('fav_cancel')} onPress={p.onCancelIndex} />
              </View>
              )
            : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><Btn text={t('adv_rebuild')} onPress={p.onRebuildIndex} disabled={!p.deviceName} /></View>
                <View style={{ flex: 1 }}><Btn text={t('adv_scan_cue')} onPress={p.onScanCue} disabled={!p.smbSaved || !p.deviceName} /></View>
              </View>
              )}
          <Btn text={t('nas_cover_scan')} onPress={p.onScanCovers} disabled={!p.deviceName || p.indexing} />
          <Btn text={t('adv_reload_pl')} onPress={p.onReloadPlaylists} disabled={!p.deviceName || p.indexing} />
          <Btn
            text={`${t('adv_autoRebuild')}：${Number(autoDays) > 0 ? `${autoDays} ${t('adv_days')}` : t('adv_off')}`}
            onPress={cycleAutoRebuild}
            disabled={p.indexing}
          />
        </Section>

        <Section title={t('adv_connect')}>
          <Btn text={t('adv_forget')} tone="danger" onPress={p.onForget} disabled={!p.deviceName} />
        </Section>

        {p.message
          ? <Text size={MX.font.rowSub} color={MX.color.text3} style={{ marginTop: 20, lineHeight: 18 }}>{p.message}</Text>
          : null}
      </ScrollView>
    </View>
  )
}
