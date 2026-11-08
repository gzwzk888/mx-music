import { useEffect, useState } from 'react'
import { getListMusics } from '@/core/list'
import { LIST_IDS } from '@/config/constant'
import { usePlayerMusicInfo } from '@/store/player/hook'

/**
 * 当前播放的歌曲是否已在「我的收藏」里
 * 用于播放页「加入列表」心型按钮高亮（与播放按钮同色）
 * @param refreshKey 外部加歌后自增，强制复查
 */
export const useInLove = (refreshKey = 0) => {
  const musicInfo = usePlayerMusicInfo()
  const musicId = String((musicInfo as any)?.id ?? '')
  const [inLove, setInLove] = useState(false)

  useEffect(() => {
    if (!musicId) {
      setInLove(false)
      return
    }
    let alive = true
    const check = () => {
      void getListMusics(LIST_IDS.LOVE).then(musics => {
        if (alive) setInLove(musics.some(m => m.id == musicId))
      }).catch(() => {})
    }
    check()
    const onChange = () => { check() }
    global.app_event.on('myListMusicUpdate', onChange)
    return () => {
      alive = false
      global.app_event.off('myListMusicUpdate', onChange)
    }
  }, [musicId, refreshKey])

  return inLove
}
