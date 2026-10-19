import { memo } from 'react'

import Section from '../../components/Section'
import IsShowHistorySearch from './IsShowHistorySearch'

import { useI18n } from '@/lang'

export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_search')}>
      <IsShowHistorySearch />
    </Section>
  )
})
