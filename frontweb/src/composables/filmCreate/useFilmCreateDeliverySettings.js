import { ref } from 'vue'

/** 制作页成片与风格设置，与剧集 id / 项目 id 无关 */
export const FILM_CREATE_DELIVERY_SETTING_KEYS = [
  'generationStyle',
  'projectAspectRatio',
  'videoClipDuration',
  'videoMusic',
  'videoSfx',
  'videoQuality',
  'videoSubtitle',
  'videoBurnDialogue',
  'videoWatermark',
  'videoWatermarkText',
]

const DEFAULTS = Object.freeze({
  generationStyle: '',
  projectAspectRatio: '16:9',
  videoClipDuration: 5,
  videoMusic: '',
  videoSfx: '',
  videoQuality: 'high',
  videoSubtitle: false,
  videoBurnDialogue: false,
  videoWatermark: false,
  videoWatermarkText: '',
})

export function snapshotFilmCreateDeliverySettings(settings) {
  const snapshot = {}
  for (const key of FILM_CREATE_DELIVERY_SETTING_KEYS) {
    snapshot[key] = settings?.[key]?.value
  }
  return snapshot
}

export function applyFilmCreateDeliverySettingsSnapshot(settings, snapshot = {}) {
  for (const key of FILM_CREATE_DELIVERY_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) continue
    settings[key].value = snapshot[key]
  }
}

export function useFilmCreateDeliverySettings() {
  const generationStyle = ref(DEFAULTS.generationStyle)
  const projectAspectRatio = ref(DEFAULTS.projectAspectRatio)
  const videoClipDuration = ref(DEFAULTS.videoClipDuration)
  const videoMusic = ref(DEFAULTS.videoMusic)
  const videoSfx = ref(DEFAULTS.videoSfx)
  const videoQuality = ref(DEFAULTS.videoQuality)
  const videoSubtitle = ref(DEFAULTS.videoSubtitle)
  const videoBurnDialogue = ref(DEFAULTS.videoBurnDialogue)
  const videoWatermark = ref(DEFAULTS.videoWatermark)
  const videoWatermarkText = ref(DEFAULTS.videoWatermarkText)

  return {
    generationStyle,
    projectAspectRatio,
    videoClipDuration,
    videoMusic,
    videoSfx,
    videoQuality,
    videoSubtitle,
    videoBurnDialogue,
    videoWatermark,
    videoWatermarkText,
  }
}
