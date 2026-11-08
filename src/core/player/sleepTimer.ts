/**
 * 定时停止播放（睡眠定时）
 * 只在内存里计时：重启 App 就作废，符合“今晚听着睡”的用途。
 */
import { pause } from '@/core/player/player'

let timer: ReturnType<typeof setTimeout> | null = null
let endsAt = 0
let minutes = 0
const listeners = new Set<() => void>()

const emit = () => { listeners.forEach(fn => { try { fn() } catch {} }) }

export const subscribeSleepTimer = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 当前设置：minutes = 0 表示未启用 */
export const getSleepTimer = () => ({ minutes, endsAt })

export const clearSleepTimer = () => {
  if (timer) clearTimeout(timer)
  timer = null
  endsAt = 0
  minutes = 0
  emit()
}

/** 设置倒计时（分钟），0 = 关闭 */
export const setSleepTimer = (min: number) => {
  if (timer) clearTimeout(timer)
  timer = null
  if (!min || min <= 0) {
    endsAt = 0
    minutes = 0
    emit()
    return
  }
  minutes = min
  endsAt = Date.now() + min * 60 * 1000
  timer = setTimeout(() => {
    timer = null
    minutes = 0
    endsAt = 0
    void pause().catch(() => {})
    emit()
  }, min * 60 * 1000)
  emit()
}
