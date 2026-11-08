import { useRef, useState } from 'react'
import MusicAddModal, { type MusicAddModalType } from '@/components/MusicAddModal'
import playerState from '@/store/player/state'
import { useTheme } from '@/store/theme/hook'
import { useInLove } from '@/screens/PlayDetail/components/useInLove'
import Btn from './Btn'


export default () => {
  const musicAddModalRef = useRef<MusicAddModalType>(null)
  const theme = useTheme()
  const [refreshKey, setRefreshKey] = useState(0)
  // 已在「我的收藏」里就把心型染成主色（和播放按钮同色）
  const inLove = useInLove(refreshKey)

  const handleShowMusicAddModal = () => {
    const musicInfo = playerState.playMusicInfo.musicInfo
    if (!musicInfo) return
    musicAddModalRef.current?.show({
      musicInfo: 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo,
      isMove: false,
      listId: playerState.playMusicInfo.listId!,
    })
  }

  return (
    <>
      <Btn icon="add-music" color={inLove ? theme['c-primary'] : undefined} onPress={handleShowMusicAddModal} />
      <MusicAddModal ref={musicAddModalRef} onAdded={() => { setRefreshKey(k => k + 1) }} />
    </>
  )
}
