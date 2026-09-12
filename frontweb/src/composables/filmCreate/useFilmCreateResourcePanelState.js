import { ref } from 'vue'

/** 资源面板折叠和四视图开关，不按剧集 id 索引 */
export function useFilmCreateResourcePanelState() {
  const resourcePanelCollapsed = ref(false)
  const charactersBlockCollapsed = ref(false)
  const propsBlockCollapsed = ref(false)
  const scenesBlockCollapsed = ref(false)
  const sceneUseQuadGrid = ref(false)
  const propUseQuadGrid = ref(false)

  return {
    resourcePanelCollapsed,
    charactersBlockCollapsed,
    propsBlockCollapsed,
    scenesBlockCollapsed,
    sceneUseQuadGrid,
    propUseQuadGrid,
  }
}
