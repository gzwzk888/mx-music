/** 跨菜单跳转意图：歌单点专辑 / 歌曲「打开所在文件夹」→ 跳到 NAS 或本机对应目录 */
export interface NavIntent {
  view: 'nas' | 'local'
  album: string
  singer?: string
  /**
   * 目标目录名
   *  - NAS：DLNA 目录标题（如「《童丽HIFI试音典藏》CD1」），由索引回溯成完整面包屑
   *  - 本机：专辑名（Local 页按专辑过滤）
   */
  folder?: string
  /** 本机曲目：文件所在目录的绝对路径 */
  dirPath?: string
  /** 曲目来源：决定音乐库筛选只看本机还是 NAS */
  origin?: 'local' | 'nas'
}

let pending: NavIntent | null = null

export const setNavIntent = (intent: NavIntent | null) => {
  pending = intent
  // 音乐库可能已经在页面上（nav 没变化，靠 active 变化收不到），用事件直达
  try { (global as any).state_event?.mxNavIntent?.() } catch {}
}
export const peekNavIntent = () => pending
export const clearNavIntent = () => { pending = null }
