import { ref } from 'vue'

/** 视频能力和成片就绪检查状态，请求键仍由调用方传入 dramaId */
export function useFilmCreateProductionCapabilityState() {
  const videoCapabilityConfigs = ref([])
  const videoCapabilityLoading = ref(true)
  const videoCapabilityFailed = ref(false)
  const authoritativeProductionReadiness = ref(null)
  const productionReadinessLoading = ref(true)
  const productionReadinessFailed = ref(false)

  return {
    videoCapabilityConfigs,
    videoCapabilityLoading,
    videoCapabilityFailed,
    authoritativeProductionReadiness,
    productionReadinessLoading,
    productionReadinessFailed,
  }
}
