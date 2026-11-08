import { useEffect } from 'react'

import MxPhone from './Mx/Phone'
import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import { useAccentTick } from '@/theme/useAccentTick'

/**
 * 播放页统一走 Mx 实现：
 * - 竖屏（高 > 宽）：封面 + 底部信息控件
 * - 横屏 / 平板（宽 ≥ 高）：左封面 + 右信息控件
 * 手机横屏与平板是同一套代码，只需验一次。
 */
export default ({ componentId }: { componentId: string }) => {
  useAccentTick()
  useEffect(() => {
    setComponentId(COMPONENT_IDS.playDetail, componentId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <PageContent>
      <StatusBar />
      <MxPhone componentId={componentId} />
    </PageContent>
  )
}
