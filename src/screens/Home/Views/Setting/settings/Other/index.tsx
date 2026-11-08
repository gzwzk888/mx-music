import { memo } from 'react'

import Section from '../../components/Section'
import ResourceCache from './ResourceCache'
import Log from './Log'
// import MaxCache from './MaxCache'
import { useI18n } from '@/lang'

export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_other')}>
      <ResourceCache />
      <Log />
      {/* <MaxCache /> */}
    </Section>
  )
})
