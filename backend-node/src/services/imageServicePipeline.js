/**
 * 图片生成管线辅助：任务状态、场景绑定与存储根路径。
 * 宫格提示词/拆分见 imageServicePipelineGrid.js，输出尺寸对齐见 imageServicePipelineNormalize.js。
 * 路由仍通过 imageService 调用，本模块不改变公开 API。
 * 参考图装配见 imageServiceReferences.js，提示词优化见 imageServicePrompt.js；
 * persistImageFailure 仍留在 imageServiceProcess.js，与用户可见错误收口放在一起。
 */

const path = require('path');
const { isUserFacingAbort } = require('./providerErrorSanitizer');
const taskService = require('./taskService');
const uploadService = require('./uploadService');
const {
  splitQuadGridToImages,
  buildQuadGridPrompt,
  buildNineGridPrompt,
  splitNineGridToImages,
  applyGridPromptIfNeeded,
  splitGeneratedGridIfNeeded,
} = require('./imageServicePipelineGrid');
const {
  normalizeLocalImageToTargetSize,
  normalizeSavedImageToTargetPixels,
} = require('./imageServicePipelineNormalize');

function imageTaskCancelled(error, signal) {
  return isUserFacingAbort(error, signal);
}

function removeUncommittedImage(storagePath, localPath, log) {
  if (!storagePath || !localPath) return;
  try {
    const resolved = uploadService.resolveStorageReference(storagePath, localPath, { allowMissing: true });
    if (resolved?.absolutePath) uploadService.removeFile(resolved.absolutePath, log);
  } catch (error) {
    log?.warn?.('[图生] 清理未提交图片失败', { local_path: localPath, error: error.message });
  }
}

function runImageTaskMutation(db, row, signal, mutation) {
  if (row.task_id) return taskService.runTaskMutation(db, row.task_id, signal, mutation);
  return db.transaction(mutation)();
}

function assertImageTaskActive(db, row, signal) {
  if (row.task_id) return taskService.throwIfTaskInactive(db, row.task_id, signal);
  if (signal?.aborted) {
    const error = new Error('操作已取消');
    error.name = 'AbortError';
    error.code = 'OPERATION_CANCELLED';
    throw error;
  }
  return null;
}

function bindCompletedSceneImage(db, row, imageUrl, localPath, now) {
  if (row.scene_id == null || row.storyboard_id != null) return { bound: false };

  if (row.frame_type === 'scene_panorama') {
    const result = db.prepare(
      `UPDATE scenes
          SET panorama_image_url = ?, panorama_local_path = ?, panorama_image_id = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`
    ).run(imageUrl, localPath, row.id, now, row.scene_id);
    return { bound: result.changes > 0, target: 'panorama' };
  }

  const oldScene = db.prepare('SELECT local_path, image_url, extra_images FROM scenes WHERE id = ?').get(row.scene_id);
  const oldPath = oldScene?.local_path || oldScene?.image_url || '';
  let sceneExtras = [];
  try { sceneExtras = oldScene?.extra_images ? JSON.parse(oldScene.extra_images) : []; } catch (_) {}
  if (!Array.isArray(sceneExtras)) sceneExtras = [];
  if (oldPath && !sceneExtras.includes(oldPath)) sceneExtras.push(oldPath);
  const sceneExtraJson = sceneExtras.length ? JSON.stringify(sceneExtras) : null;
  try {
    db.prepare("UPDATE scenes SET image_url = ?, local_path = ?, extra_images = ?, status = 'generated', updated_at = ? WHERE id = ?").run(
      imageUrl, localPath, sceneExtraJson, now, row.scene_id
    );
  } catch (e) {
    if ((e.message || '').includes('extra_images')) {
      db.prepare("UPDATE scenes SET image_url = ?, local_path = ?, status = 'generated', updated_at = ? WHERE id = ?").run(
        imageUrl, localPath, now, row.scene_id
      );
    } else {
      throw e;
    }
  }
  return { bound: true, target: 'main' };
}

function resolveStorageRoot(cfg) {
  return path.isAbsolute(cfg.storage?.local_path)
    ? cfg.storage.local_path
    : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
}

module.exports = {
  imageTaskCancelled,
  removeUncommittedImage,
  runImageTaskMutation,
  assertImageTaskActive,
  resolveStorageRoot,
  splitQuadGridToImages,
  buildQuadGridPrompt,
  buildNineGridPrompt,
  splitNineGridToImages,
  applyGridPromptIfNeeded,
  normalizeLocalImageToTargetSize,
  normalizeSavedImageToTargetPixels,
  bindCompletedSceneImage,
  splitGeneratedGridIfNeeded,
};
