/**
 * 歌曲属性数据来源：
 *   - 本机歌曲：扫描时把 MediaStore 的 size/duration 登记进来
 *   - NAS 歌曲：HEAD 请求取 Content-Length
 */

export interface MediaProps {
  size?: number
  durationMs?: number
}

const localProps = new Map<string, MediaProps>()

export const registerLocalProps = (path: string, props: MediaProps) => {
  if (path) localProps.set(path, props)
}

export const getLocalProps = (path?: string | null): MediaProps | undefined => {
  return path ? localProps.get(path) : undefined
}

/** 取远端文件大小（字节）：先 HEAD，失败再用 Range 请求兜底；都不行返回 null */
export const getRemoteSize = async(url: string, timeoutMs = 6000): Promise<number | null> => {
  const request = async(init: RequestInit): Promise<number | null> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => { ctrl.abort() }, timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal })
      const len = res.headers.get('content-length')
      if (len) return Number(len)
      const range = res.headers.get('content-range')
      const m = range ? /\/(\d+)$/.exec(range) : null
      return m ? Number(m[1]) : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  const byHead = await request({ method: 'HEAD' })
  if (byHead) return byHead
  return await request({ method: 'GET', headers: { Range: 'bytes=0-0' } })
}
