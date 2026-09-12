import { useFilmCreateResourceGenerate } from './useFilmCreateResourceGenerate.js'
import { useFilmCreateResourceUpload } from './useFilmCreateResourceUpload.js'

/**
 * 装配角色/道具/场景生成包装和资源图上传。
 * 只搬家，不创建新状态，不改空剧本门闩。
 */
export function useFilmCreateResourceActions(ctx = {}) {
  const generate = useFilmCreateResourceGenerate(ctx)
  const upload = useFilmCreateResourceUpload(ctx)
  return {
    ...generate,
    ...upload,
  }
}
