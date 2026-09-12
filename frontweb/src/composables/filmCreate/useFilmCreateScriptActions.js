import { useFilmCreateScriptPersistence } from './useFilmCreateScriptPersistence.js'
import { useFilmCreateScriptWorkspace } from './useFilmCreateScriptWorkspace.js'

/**
 * 装配剧本保存、设置持久化和工作台导入动作。
 * 只搬家，不创建新状态，不改空剧本门闩。
 */
export function useFilmCreateScriptActions(ctx = {}) {
  const persistence = useFilmCreateScriptPersistence(ctx)
  const workspace = useFilmCreateScriptWorkspace({
    ...ctx,
    saveScriptToBackend: persistence.saveScriptToBackend,
  })
  return {
    ...persistence,
    ...workspace,
  }
}
