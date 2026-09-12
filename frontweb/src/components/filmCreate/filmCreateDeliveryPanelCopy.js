/** 交付面板空态、禁用原因和按钮读屏文案 */

import {
  describeActionAriaLabel,
  describeActionTitle,
  toFilmCreateDisabledReasonText,
  toFilmCreateOptionalUserFacingText,
  toFilmCreateUserFacingText,
} from './filmCreateActionCopy.js'

export function describeDeliveryPanelState(input = {}) {
  const playable = Math.max(0, Math.floor(Number(input.playableStoryboardVideoCount) || 0))
  const total = Math.max(0, Math.floor(Number(input.storyboardCount) || 0))
  const composeDisabledReason = toFilmCreateDisabledReasonText(input.composeActionDisabledReason, '当前不能合成成片')
  const downloadVideoDisabledReason = input.currentEpisodeVideoUrl ? '' : '请先合成成片后再下载'
  const downloadSubtitleDisabledReason = !input.currentEpisodeId
    ? '请先选择剧集'
    : (input.deliverySubtitleAvailable ? '' : '当前集还没有可下载的字幕')
  const exportProjectDisabledReason = input.dramaId ? '' : '请先打开制作项目'

  let guidanceKind = ''
  let guidanceText = ''
  let guidanceAnchor = ''
  let guidanceActionLabel = ''
  if (/请先创建或选择剧集|请先打开制作项目/.test(composeDisabledReason)) {
    guidanceKind = 'disabled'
    guidanceText = composeDisabledReason
  } else if (playable <= 0) {
    guidanceKind = 'empty'
    if (total > 0) {
      guidanceText = `还没有可播放的分镜视频（已完成 0/${total}）。请先到「分镜」面板为每个镜头生成视频，全部完成后再回来合成成片。`
      guidanceAnchor = 'anchor-storyboard-images'
      guidanceActionLabel = '去分镜面板生成视频'
    } else {
      guidanceText = '还没有可播放的分镜视频。请先到「分镜」面板生成或添加分镜，再为每个镜头生成视频。'
      guidanceAnchor = 'anchor-storyboard'
      guidanceActionLabel = '去分镜面板添加分镜'
    }
  } else if (composeDisabledReason) {
    guidanceKind = 'disabled'
    guidanceText = composeDisabledReason
  }

  const composeActionLabel = input.currentEpisodeVideoUrl ? '重新合成' : '合成成片'
  const downloadVideoActionLabel = input.videoDownloadStatus === 'error' ? '重试下载' : '下载成片'
  const downloadSubtitleActionLabel = input.deliveryExportStatus?.subtitle === 'error' ? '重试字幕' : '下载字幕'
  const exportProjectActionLabel = input.deliveryExportStatus?.project === 'error' ? '重试项目包' : '导出项目包'

  return {
    composeDisabledReason,
    downloadVideoDisabledReason,
    downloadSubtitleDisabledReason,
    exportProjectDisabledReason,
    guidanceKind,
    guidanceText,
    guidanceAnchor,
    guidanceActionLabel,
    composeActionLabel,
    downloadVideoActionLabel,
    downloadSubtitleActionLabel,
    exportProjectActionLabel,
    composeButtonAriaLabel: describeActionAriaLabel(composeActionLabel, {
      loading: input.videoStatus === 'generating',
      loadingLabel: '正在合成成片',
      disabledReason: composeDisabledReason,
    }),
    composeButtonTitle: describeActionTitle({
      loading: input.videoStatus === 'generating',
      loadingLabel: '正在合成成片',
      disabledReason: composeDisabledReason,
    }),
    downloadVideoButtonAriaLabel: describeActionAriaLabel(downloadVideoActionLabel, {
      loading: input.videoDownloadStatus === 'downloading',
      loadingLabel: '正在下载成片',
      disabledReason: downloadVideoDisabledReason,
    }),
    downloadVideoButtonTitle: describeActionTitle({
      loading: input.videoDownloadStatus === 'downloading',
      loadingLabel: '正在下载成片',
      disabledReason: downloadVideoDisabledReason,
    }),
    downloadSubtitleButtonAriaLabel: describeActionAriaLabel(downloadSubtitleActionLabel, {
      loading: input.deliveryExportStatus?.subtitle === 'downloading',
      loadingLabel: '正在下载字幕',
      disabledReason: downloadSubtitleDisabledReason,
    }),
    downloadSubtitleButtonTitle: describeActionTitle({
      loading: input.deliveryExportStatus?.subtitle === 'downloading',
      loadingLabel: '正在下载字幕',
      disabledReason: downloadSubtitleDisabledReason,
    }),
    exportProjectButtonAriaLabel: describeActionAriaLabel(exportProjectActionLabel, {
      loading: input.deliveryExportStatus?.project === 'downloading',
      loadingLabel: '正在导出项目包',
      disabledReason: exportProjectDisabledReason,
    }),
    exportProjectButtonTitle: describeActionTitle({
      loading: input.deliveryExportStatus?.project === 'downloading',
      loadingLabel: '正在导出项目包',
      disabledReason: exportProjectDisabledReason,
    }),
    videoErrorMsg: input.videoStatus === 'error'
      ? toFilmCreateUserFacingText(input.videoErrorMsg, '成片合成失败，请稍后重试')
      : toFilmCreateOptionalUserFacingText(input.videoErrorMsg, '成片合成失败，请稍后重试'),
    videoDownloadError: input.videoDownloadStatus === 'error'
      ? toFilmCreateUserFacingText(input.videoDownloadError, '成片下载失败，请稍后重试')
      : toFilmCreateOptionalUserFacingText(input.videoDownloadError, '成片下载失败，请稍后重试'),
    deliveryExportFeedback: input.deliveryExportHasError
      ? toFilmCreateUserFacingText(input.deliveryExportFeedback, '导出失败，请稍后重试')
      : toFilmCreateOptionalUserFacingText(input.deliveryExportFeedback, '导出失败，请稍后重试'),
    deliveryPackageHint: '随时可导出工程',
  }
}
