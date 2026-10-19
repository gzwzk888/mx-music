/** 跨菜单跳转意图：歌单点专辑 → 跳到 NAS / 本机 对应目录 */
export interface NavIntent {
  view: 'nas' | 'local'
  album: string
  singer?: string
}

let pending: NavIntent | null = null

export const setNavIntent = (intent: NavIntent | null) => { pending = intent }
export const peekNavIntent = () => pending
export const clearNavIntent = () => { pending = null }
