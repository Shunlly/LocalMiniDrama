'use strict';

// 视频生成客户端：协议路由、轮询与公开 API。厂商请求实现位于 videoGateway。
const {
  createSafeVideoLogger,
  fetchVideoWithTimeout,
  resolveVideoProtocol,
  getModelFromConfig,
  isPlausibleHttpVideoUrl,
  pickProxyVideoUrl,
  formatVideoPostBodyForLog,
  normalizeAspectRatioForApi,
} = require('./videoGateway/helpers');
const {
  validateVideoMediaReferences,
  validateProviderDispatch,
  validateProviderRequestUrl,
  loadReferenceImageBuffer,
} = require('./videoGateway/mediaRefs');
const {
  buildAgnesVideoImagePayload,
} = require('./videoGateway/agnesVideoAdapter');
const {
  resolveJimengApiImageBuffer,
} = require('./videoGateway/jimengVideoAdapter');
const { getDefaultVideoConfig } = require('./videoGateway/config');
const { callVideoApi } = require('./videoGateway/videoApiCall');
const { pollVideoTask } = require('./videoClientPoll');

module.exports = {
  getDefaultVideoConfig,
  callVideoApi,
  pollVideoTask,
  normalizeAspectRatioForApi,
  isPlausibleHttpVideoUrl,
  pickProxyVideoUrl,
  buildAgnesVideoImagePayload,
  formatVideoPostBodyForLog,
  resolveVideoProtocol,
  fetchVideoWithTimeout,
  createSafeVideoLogger,
  loadReferenceImageBuffer,
  resolveJimengApiImageBuffer,
  validateProviderDispatch,
  validateProviderRequestUrl,
  validateVideoMediaReferences,
};
