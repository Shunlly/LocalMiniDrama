// 从 sourceMediaExtractionService 拆出的错误装配：统一 BAD_REQUEST 与进程/服务失败文案。

function actionableError(message, cause) {
  const err = new Error(message, cause ? { cause } : undefined);
  err.code = 'BAD_REQUEST';
  return err;
}

function withProcessCode(error, processCode) {
  error.process_code = processCode;
  return error;
}

function processUnavailableError(label, cause) {
  return withProcessCode(
    actionableError(`${label} 不可用。请确认本机已安装对应工具，或检查 AI 配置后重试。`, cause),
    'PROCESS_UNAVAILABLE'
  );
}

function processChildError(label, cause) {
  return withProcessCode(
    actionableError(`${label} 不可用。请确认本机已安装对应工具，或检查 AI 配置后重试。`, cause),
    cause?.code === 'ENOENT' ? 'PROCESS_UNAVAILABLE' : 'PROCESS_FAILED'
  );
}

function processFailedError(label, code) {
  return withProcessCode(
    actionableError(`${label} 失败，退出码 ${code}。请检查源文件后重试。`),
    'PROCESS_FAILED'
  );
}

function processTimeoutError(label) {
  return actionableError(`${label}超时。请缩短源文件或稍后重试。`);
}

function processOutputOverflowError(label) {
  return actionableError(`${label} 输出过多。请换更小的源文件后重试。`);
}

function processDiagnosticOverflowError(label) {
  return actionableError(`${label} 诊断输出过多。请换更小的源文件后重试。`);
}

function providerTimeoutError(label, cause) {
  return actionableError(`${label}超时，请检查当前 AI 配置后重试。`, cause);
}

function providerUnreachableError(label, cause) {
  return actionableError(`${label}无法连接。请检查当前 AI 配置中的接口地址后重试。`, cause);
}

function providerBadResponseError(label) {
  return actionableError(`${label}返回了无法处理的响应。请检查当前 AI 配置。`);
}

function throwOcrFallbackError(config, tesseract, providerError) {
  if (!config && tesseract.unavailable) {
    throw actionableError('未配置图片识别服务，且本机 Tesseract 不可用。请在「AI 配置」中添加并启用「图片识别」，或安装 Tesseract 命令行工具。');
  }
  if (providerError) throw providerError;
  throw actionableError('图片识别失败。请检查「图片识别」配置或本机 Tesseract 安装。', tesseract.error);
}

module.exports = {
  actionableError,
  processUnavailableError,
  processChildError,
  processFailedError,
  processTimeoutError,
  processOutputOverflowError,
  processDiagnosticOverflowError,
  providerTimeoutError,
  providerUnreachableError,
  providerBadResponseError,
  throwOcrFallbackError,
};
