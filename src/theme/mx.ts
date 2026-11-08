/**
 * MX 新的设计 token —— 取自 Onkyo HF Player 的配色体系（深黑 + 单一冷蓝强调）
 * 目的：新页面一律用这里，不改全局 theme，避免影响还没重做的旧页。
 */
import settingState from '@/store/setting/state'

/**
 * 强调色可选值：蓝（默认）/ 黄 / 橙红
 */
export const MX_ACCENTS = {
  blue: { main: '#46aaff', dim: 'rgba(70,170,255,0.16)' },
  yellow: { main: '#828804', dim: 'rgba(130,136,4,0.20)' },
  orange: { main: '#c86400', dim: 'rgba(200,100,0,0.20)' },
  green: { main: '#00552B', dim: 'rgba(0,85,43,0.20)' },
} as const

export const getAccent = () => {
  const id = settingState.setting['mx.accentColor']
  return (MX_ACCENTS as any)[id] ?? MX_ACCENTS.blue
}

export const MX = {
  color: {
    app: '#0a0a0a',          // 应用底
    page: '#141414',         // 页面底
    panel: '#1e1e1e',        // 面板 / 弹层
    card: '#282828',         // 卡片 / 行按下
    line: '#2a2a2a',         // 分割线
    lineSoft: '#1c1c1c',
    text: '#f0f0f0',         // 主文字
    text2: '#aaaaaa',        // 次文字
    text3: '#787878',        // 弱文字
    text4: '#5a5a5a',        // 轴标 / 占位
    get accent() { return getAccent().main },        // 唯一强调色（可切换）
    get accentDim() { return getAccent().dim },
    white: '#ffffff',
    iconIdle: '#c8c8c8',
    circle: 'rgba(255,255,255,0.06)',   // 圆形按钮底
    get circleOn() { return getAccent().dim },   // 圆形按钮按下底（跟随强调色）
    mini: '#111111',
  },
  font: {
    title: 19,     // 页面 / 播放页标题
    section: 15,
    row: 13,
    rowSub: 11,
    caption: 10.5,
    tab: 12.5,
    badge: 9.5,
  },
  space: {
    page: 16,      // 页面左右边距
    pageLg: 22,    // 播放页左右边距
    row: 8,        // 行内上下 padding
    gap: 11,
  },
  size: {
    icon: 22,        // 常规图标
    iconSm: 18,
    iconLg: 24,
    btn: 34,         // 圆形按钮
    btnLg: 56,       // 播放页主按钮
    art: 40,         // 列表封面
    artSm: 34,       // 迷你条封面
    rowMin: 56,      // 行最小高
    topBar: 52,
  },
  radius: {
    art: 3,
    chip: 999,
    card: 6,
  },
}

/** 顶部安全区 + 顶栏高度，供新页面统一计算 */
export const MX_TOP_BAR_H = MX.size.topBar

export default MX
