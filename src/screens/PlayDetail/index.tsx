import { useEffect } from 'react'
// import { View, StyleSheet } from 'react-native'
import { useHorizontalMode, useWindowSize } from '@/utils/hooks'

import Vertical from './Vertical'
import Horizontal from './Horizontal'
import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'

export default ({ componentId }: { componentId: string }) => {
  const isHorizontalMode = useHorizontalMode()
  const { width } = useWindowSize()
  // 平板/宽屏：竖屏也使用「封面 + 歌词并排」布局
  const isWide = isHorizontalMode || width >= 700

  useEffect(() => {
    setComponentId(COMPONENT_IDS.playDetail, componentId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <PageContent>
      <StatusBar />
      {
        isWide
          ? <Horizontal componentId={componentId} />
          : <Vertical componentId={componentId} />
      }
    </PageContent>
  )
}
