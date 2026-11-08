import { existsFile } from './fs'


export const getLocalFilePath = async(musicInfo: LX.Music.MusicInfoLocal): Promise<string> => {
  // NAS / 远程流地址：直接返回，不做本地文件存在性检查
  if (/^https?:\/\//i.test(musicInfo.meta.filePath)) return musicInfo.meta.filePath
  if (await existsFile(musicInfo.meta.filePath)) return musicInfo.meta.filePath
  // 直接从应用外 intent 调用打开的文件，ogg等类型无法判断文件是否存在，但这类文件路径为纯数字
  return /\/\d+$/.test(musicInfo.meta.filePath) ? musicInfo.meta.filePath : ''
}
