import { useEffect, useMemo, useState } from 'react'
import Search from '../Views/LocalSearch'
import SongList from '../Views/SongList'
import Favorites from '../Views/Favorites'
import Setting from '../Views/Setting'
import Nas from '../Views/Nas'
import Library from '../Views/Library'
import Dirs from '../Views/Dirs'
import commonState, { type InitState as CommonState } from '@/store/common/state'


const Main = () => {
  const [id, setId] = useState(commonState.navActiveId)

  useEffect(() => {
    const handleUpdate = (id: CommonState['navActiveId']) => {
      requestAnimationFrame(() => {
        setId(id)
      })
    }
    global.state_event.on('navActiveIdUpdated', handleUpdate)
    return () => {
      global.state_event.off('navActiveIdUpdated', handleUpdate)
    }
  }, [])

  const component = useMemo(() => {
    switch (id) {
      case 'nav_songlist': return <SongList />
      case 'nav_love': return <Favorites />
      case 'nav_nas': return <Nas />
      case 'nav_dirs': return <Dirs />
      case 'nav_local': return <Library />
      case 'nav_setting': return <Setting />
      case 'nav_search':
      default: return <Search />
    }
  }, [id])

  return component
}


export default Main

