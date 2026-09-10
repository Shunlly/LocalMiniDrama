/**
 * AI 配置页「服务状态 / 配置管理」工作区切换。
 * 页面仍持有 tab 选中态和按钮 ref；这里只处理点击与键盘切到对应工作区。
 */
import { nextTick as vueNextTick } from 'vue'
import { getConfigWorkspaceKeyTarget } from '@/utils/aiConfigWorkspace.js'

export function useAiConfigWorkspaceView(deps = {}) {
  const {
    configWorkspaceView,
    coverageWorkspaceModeRef,
    configsWorkspaceModeRef,
  } = deps
  const nextTick = deps.nextTick || vueNextTick

  function selectConfigWorkspaceView(view, { focus = false } = {}) {
    configWorkspaceView.value = view
    if (!focus) return
    nextTick(() => {
      const target = view === 'coverage' ? coverageWorkspaceModeRef.value : configsWorkspaceModeRef.value
      target?.focus?.()
    })
  }

  function onConfigWorkspaceKeydown(currentView, event) {
    const target = getConfigWorkspaceKeyTarget(currentView, event.key)
    if (!target) return
    event.preventDefault()
    selectConfigWorkspaceView(target, { focus: true })
  }

  return {
    selectConfigWorkspaceView,
    onConfigWorkspaceKeydown,
  }
}
