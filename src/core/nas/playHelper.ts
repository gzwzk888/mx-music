import { LIST_IDS } from '@/config/constant'
import { addListMusics, clearListMusics } from '@/core/list'
import { playListById } from '@/core/player/player'

/**
 * 用内置「试听列表」播放一组歌：
 * 不再创建「本机音乐 / 搜索 / 最近 / 华语热门」这些自建列表
 */
export const playInTempList = async(infos: LX.Music.MusicInfoLocal[], targetId?: string) => {
  if (!infos.length) return
  await clearListMusics([LIST_IDS.DEFAULT])
  await addListMusics(LIST_IDS.DEFAULT, infos, 'bottom')
  await playListById(LIST_IDS.DEFAULT, targetId ?? infos[0].id)
}
