import { ElMessage, ElMessageBox } from 'element-plus'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'

export function useFilmCreateTailFrameLink(deps = {}) {
  const {
    dramaId,
    storyboardsAPI,
    imagesAPI,
    getNextStoryboard,
    getPrevStoryboard,
    getSbVideo,
    getSbLastImage,
    linkingTailFrameIds,
    usingPrevTailAsFirstIds,
    refreshStoryboardMediaForCurrentContext,
    refreshStoryboardsOnly,
    onSelectSbFrameImage,
    sbSelectedImgId,
  } = deps

  /** 尾帧衔接：提取当前视频最后一帧，设为下一个分镜的首帧 */
  async function onLinkTailFrameToNext(sb) {
    if (!dramaId.value || !sb?.id) return
    const nextSb = getNextStoryboard(sb.id)
    if (!nextSb) {
      ElMessage.warning('已是最后一个分镜，没有下一个分镜可衔接')
      return
    }
    const video = getSbVideo(sb.id)
    if (!video) {
      ElMessage.warning('当前分镜没有视频')
      return
    }
    try {
      await ElMessageBox.confirm(
        `确定将 #${sb.storyboard_number ?? sb.id} 视频的尾帧设为 #${nextSb.storyboard_number ?? nextSb.id} 的首帧？\n原首帧将自动进入历史。`,
        '尾帧衔接',
        { confirmButtonText: '确认执行', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
    linkingTailFrameIds.add(sb.id)
    try {
      const data = await storyboardsAPI.linkTailFrame(sb.id, { drama_id: dramaId.value })
      if (data?.error) {
        throw new Error(data.error)
      }
      ElMessage.success(`已将尾帧设为 #${nextSb.storyboard_number ?? nextSb.id} 的首帧`)
      // 刷新两个分镜的媒体
      await Promise.all([
        refreshStoryboardMediaForCurrentContext(sb.id),
        refreshStoryboardMediaForCurrentContext(nextSb.id)
      ])
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '尾帧衔接失败'))
    } finally {
      linkingTailFrameIds.delete(sb.id)
    }
  }

  /** 上镜尾帧：直接把上一分镜的尾帧图片（高清原图）设为当前分镜的首帧，无需 ffmpeg 提取视频帧，画面更清晰 */
  async function onUsePrevTailAsFirst(sb) {
    if (!dramaId.value || !sb?.id) return
    const prevSb = getPrevStoryboard(sb.id)
    if (!prevSb) {
      ElMessage.warning('已是第一个分镜，没有上一分镜可取尾帧')
      return
    }
    const prevLastImg = getSbLastImage(prevSb.id)
    if (!prevLastImg) {
      ElMessage.warning(`上一分镜 #${prevSb.storyboard_number ?? prevSb.id} 尚无尾帧图片`)
      return
    }

    // 直接执行，不再弹确认框（用户已通过按钮 + tooltip 明确意图）
    usingPrevTailAsFirstIds.add(sb.id)
    try {
      // 通过 upload 接口在“当前分镜”下创建一个 image 记录（复用上一镜尾帧的物理文件路径/URL），frame_type 触发后端自动 bind
      const uploaded = await imagesAPI.upload({
        storyboard_id: sb.id,
        drama_id: dramaId.value,
        image_url: prevLastImg.image_url || '',
        local_path: prevLastImg.local_path || undefined,
        prompt: `上镜尾帧（直接复用 #${prevSb.storyboard_number ?? prevSb.id} 尾帧高清原图）`,
        frame_type: 'storyboard_first'
      })
      if (uploaded?.id) {
        // 手动设置本地选中，确保显示立即切换；同时调用 onSelect 做一次 server patch（与 upload 里的 bind 互补）
        onSelectSbFrameImage(sb, uploaded, 'first')
      }
      ElMessage.success(`已将 #${prevSb.storyboard_number ?? prevSb.id} 尾帧设为本分镜首帧（高清原图）`)

      // 刷新分镜元数据（拿回服务器最新的 first_frame_image_id）+ 媒体列表
      await Promise.all([
        refreshStoryboardsOnly(),
        refreshStoryboardMediaForCurrentContext(sb.id)
      ])
      // 清除可能残留的手动选中（让服务器权威绑定 id 生效）
      delete sbSelectedImgId.value[sb.id]
    } catch (e) {
      if (isUserFacingAbort(e)) return
      ElMessage.error(toUserFacingError(e, '上镜尾帧设置失败'))
    } finally {
      usingPrevTailAsFirstIds.delete(sb.id)
    }
  }

  return {
    onLinkTailFrameToNext,
    onUsePrevTailAsFirst,
  }
}
