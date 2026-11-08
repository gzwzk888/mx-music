import { useEffect } from 'react'
import { useHorizontalMode } from '@/utils/hooks'
import PageContent from '@/components/PageContent'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import Vertical from './Vertical'
import Horizontal from './Horizontal'
import { navigations } from '@/navigation'
import settingState from '@/store/setting/state'
import { useAccentTick } from '@/theme/useAccentTick'
import { preloadLocalIndex } from '@/core/local/dirs'
import { preloadNasIndex } from '@/core/nas/session'


interface Props {
  componentId: string
}


export default ({ componentId }: Props) => {
  useAccentTick()
  const isHorizontalMode = useHorizontalMode()
  useEffect(() => {
    setComponentId(COMPONENT_IDS.home, componentId)
    // 预热索引：本机 + NAS 各读一次（异步，不阻塞首屏），进「音乐库」时直接命中内存
    preloadLocalIndex()
    preloadNasIndex()
    // eslint-disable-next-line react-hooks/exhaustive-deps

    if (settingState.setting['player.startupPushPlayDetailScreen']) {
      navigations.pushPlayDetailScreen(componentId, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <PageContent>
      {
        isHorizontalMode
          ? <Horizontal />
          : <Vertical />
      }
    </PageContent>
  )
}
