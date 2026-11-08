import { useState, useRef, useEffect } from 'react'
import { View } from 'react-native'
import Input, { type InputType } from '@/components/common/Input'
import { confirmDialog, createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { createUserList } from '@/core/list'
import { listMusicAdd } from '@/utils/listManage'
import { checkUpdateList } from '@/event/listEvent'
import listState from '@/store/list/state'
import settingState from '@/store/setting/state'

/**
 * 弹窗里的「新建列表」输入框。
 * songs：新建成功后直接加进新列表 —— 原来只建空列表，用户得再点一次那个列表，
 *       表现就是「新建了却一首都没进去」。
 */
export default ({ isEdit, onHide, songs, onCreated }: {
  isEdit: boolean
  onHide: () => void
  songs?: LX.Music.MusicInfo[]
  onCreated?: (listId: string, name: string) => void
}) => {
  const [text, setText] = useState('')
  const inputRef = useRef<InputType>(null)
  /** onBlur 与 onSubmitEditing 会同时触发（回车 → 失焦），不加锁会建出两个同名列表 */
  const submittingRef = useRef(false)
  const t = useI18n()

  useEffect(() => {
    if (isEdit) {
      setText('')
      submittingRef.current = false
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [isEdit])

  const handleSubmitEditing = async() => {
    if (submittingRef.current) return
    const name = text.trim()
    if (!name.length) {
      onHide()
      return
    }
    if (listState.userList.some(l => l.name == name)) {
      submittingRef.current = true
      const ok = await confirmDialog({ message: global.i18n.t('list_duplicate_tip') })
      if (!ok) {
        submittingRef.current = false
        return
      }
    }
    submittingRef.current = true
    onHide()
    const listId = `userlist_${Date.now()}`
    try {
      await createUserList(listState.userList.length, [{ id: listId, name, locationUpdateTime: null }])
      if (songs?.length) {
        // 注意：这里不能走 core 的 addListMusics（→ list_event.list_music_add）。
        // 实测新建列表后紧接着调它，本地列表拿不到这次新增（allMusicList 仍为 0 条），
        // 只有直接落到 listMusicAdd 才生效；持久化与 UI 通知由 checkUpdateList 补上。
        await listMusicAdd(listId, songs, settingState.setting['list.addMusicLocationType'])
        await checkUpdateList([listId])
      }
      onCreated?.(listId, name)
    } catch (e: any) {
      console.log('MXADDLIST FAIL', String(e?.message ?? e))
    }
  }

  return isEdit
    ? (
      <View style={styles.imputContainer}>
        <Input
          placeholder={t('list_create_input_placeholder')}
          value={text}
          onChangeText={setText}
          ref={inputRef}
          onBlur={handleSubmitEditing}
          onSubmitEditing={handleSubmitEditing}
          style={styles.input}
        />
      </View>
      )
    : null
}

const styles = createStyle({
  imputContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    paddingBottom: 10,
  },
  input: {
    flex: 1,
    fontSize: 14,
    borderRadius: 4,
    textAlign: 'center',
    height: '100%',
  },
})
