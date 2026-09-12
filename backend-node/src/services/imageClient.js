// 与 Go pkg/image + ImageGenerationService 对齐：调用图片生成 API，更新 image_generations 与角色头像
const {
  fixAgnesImageSize,
  isAgnesImageConfig,
} = require('./imageGateway/sizeAdapters');
const {
  getStoryboardReferenceLimits,
  canAddStoryboardCharacterRef,
  canAddStoryboardObjectRef,
  refListHasCanonical,
} = require('./imageGateway/referenceUtils');
const {
  getProxyCache,
  getProxyCacheValidated,
  deleteProxyCache,
  isProxyUrlAlive,
  setProxyCache,
} = require('./imageGateway/proxyCache');
const {
  downloadImageToLocalAbortable,
  removeDownloadedImage,
} = require('./imageGateway/download');
const {
  resolveAssetUserNegativeForApi,
  getDefaultImageConfig,
  getModelFromConfig,
} = require('./imageGateway/config');
const { callImageApi } = require('./imageGateway/imageApiCall');
const { createAndGenerateImage: createAndGenerateImageWithApi } = require('./imageGateway/createAndGenerateImage');

function createAndGenerateImage(db, log, opts) {
  return createAndGenerateImageWithApi(db, log, opts, module.exports);
}

// 厂商适配与 createAndGenerateImage 编排已拆到 imageGateway/，本文件保留稳定导出。

module.exports = {
  getDefaultImageConfig,
  callImageApi,
  createAndGenerateImage,
  downloadImageToLocalAbortable,
  removeDownloadedImage,
  resolveAssetUserNegativeForApi,
  getStoryboardReferenceLimits,
  canAddStoryboardCharacterRef,
  canAddStoryboardObjectRef,
  refListHasCanonical,
  fixAgnesImageSize,
  isAgnesImageConfig,
  /** 图床 URL 缓存（image_proxy_cache），供 SD2 认证等复用 */
  getProxyCache,
  getProxyCacheValidated,
  deleteProxyCache,
  isProxyUrlAlive,
  setProxyCache,
};
