'use strict';

// 视频任务轮询已搬到 videoGateway/pollTask.js，本文件只做稳定导出。
const { pollVideoTask } = require('./videoGateway/pollTask');

module.exports = {
  pollVideoTask,
};
