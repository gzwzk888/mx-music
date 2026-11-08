/**
 * 强调色订阅：颜色一变就让调用它的组件重渲染。
 * 用法：在页面/面板组件顶层调用 useAccentTick()（返回值不用）。
 * 只订阅不消费，真正的颜色仍从 MX.color.accent 读（getter）。
 */
import { useSettingValue } from '@/store/setting/hook'

export const useAccentTick = (): string => {
  return String(useSettingValue('mx.accentColor') ?? 'blue')
}
