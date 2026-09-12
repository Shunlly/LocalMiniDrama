// AI 兼容接口的限流 HTTP 客户端：钉住 DNS、限制体积、超时与取消。
const aiConfigService = require('./aiConfigService');
const uploadService = require('./uploadService');
const { validateHttpRequestTarget } = require('./secureHttpFetch');
const { secureHttpsRequestOptions } = require('./tlsPolicy');
const https = require('https');
const http = require('http');
const net = require('net');
const {
  sanitizeProviderException,
  isTrustedChineseUserError,
  createProviderHttpError,
  isTimeoutLikeError,
} = require('./providerErrorSanitizer');

const JSON_REQUEST_MAX_BYTES = 128 * 1024 * 1024;
const JSON_RESPONSE_MAX_BYTES = 128 * 1024 * 1024;
const TEXT_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const STREAM_RESPONSE_MAX_BYTES = 32 * 1024 * 1024;
function providerNetworkOptions(config, lookup, signal) {
  return aiConfigService.getProviderNetworkOptions(config, { lookup, signal });
}

function createTimeoutError(operation) {
  const error = new Error(operation + '超时，请稍后重试。');
  error.name = 'TimeoutError';
  error.isTimeout = true;
  error.code = 'ETIMEDOUT';
  const safe = safeRequestError(error, operation);
  safe.name = 'TimeoutError';
  safe.isTimeout = true;
  return safe;
}

function createAbortError(signal) {
  const reason = signal?.reason;
  if (isTimeoutLikeError(reason) || reason?.isTimeout === true) {
    return createTimeoutError('AI 请求');
  }
  if (reason?.name === 'AbortError' && isTrustedChineseUserError(reason.message)) {
    return reason;
  }
  const error = new Error('AI 请求已取消。');
  error.name = 'AbortError';
  if (reason !== undefined) error.cause = reason;
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError(signal);
}

async function pinnedRequestTarget(url, networkOptions = {}) {
  const validated = await validateHttpRequestTarget(url, networkOptions);
  const selected = validated.addresses[0];
  return {
    parsed: validated.parsed,
    requestOptions: secureHttpsRequestOptions({
      protocol: validated.parsed.protocol,
      hostname: validated.parsed.hostname,
      port: validated.parsed.port || (validated.parsed.protocol === 'https:' ? 443 : 80),
      path: validated.parsed.pathname + validated.parsed.search,
      servername: net.isIP(validated.parsed.hostname) ? undefined : validated.parsed.hostname,
      lookup: uploadService.createPinnedDnsLookup(selected),
    }),
  };
}

function assertRequestBodyLimit(bodyStr, maxBytes = JSON_REQUEST_MAX_BYTES) {
  const bytes = Buffer.byteLength(bodyStr);
  if (bytes > maxBytes) {
    throw new uploadService.UnsafeMediaReferenceError('AI 请求内容超过大小限制。');
  }
  return bytes;
}

function collectResponse(res, maxBytes, onComplete, onError) {
  const declaredLength = Number(res.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    res.destroy();
    onError(new uploadService.UnsafeMediaReferenceError('AI 响应内容超过大小限制。'));
    return;
  }
  const chunks = [];
  let bytes = 0;
  res.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      res.destroy(new uploadService.UnsafeMediaReferenceError('AI 响应内容超过大小限制。'));
      return;
    }
    chunks.push(chunk);
  });
  res.on('end', () => onComplete(Buffer.concat(chunks, bytes).toString('utf8')));
  res.on('error', onError);
}

function safeRequestError(error, operation) {
  return sanitizeProviderException(error, {
    provider: 'AI 服务',
    operation,
  });
}

/**
 * 非流式 POST，发送 JSON body，等待完整 HTTP 响应后返回。
 * 用于视觉分析等短请求，兼容 o-series 推理模型和各种第三方代理。
 */
async function postJSONNonStream(url, headers, body, timeoutMs = 120000, networkOptions = {}) {
  const signal = networkOptions.signal;
  throwIfAborted(signal);
  const target = await pinnedRequestTarget(url, networkOptions);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const mod = target.parsed.protocol === 'https:' ? https : http;
    const bodyStr = JSON.stringify(body);
    const bodyBytes = assertRequestBodyLimit(bodyStr, networkOptions.maxRequestBytes);
    const reqHeaders = {
      'Content-Type': 'application/json',
      'Content-Length': bodyBytes,
      ...headers,
    };
    const options = {
      ...target.requestOptions,
      method: 'POST',
      headers: reqHeaders,
    };

    let settled = false;
    let timer = null;
    let req = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const succeed = (value) => finish(resolve, value);
    const fail = (error) => finish(reject, error);
    const onAbort = () => {
      const error = createAbortError(signal);
      req?.destroy(error);
      fail(error);
    };

    req = mod.request(options, (res) => {
      collectResponse(res, networkOptions.maxResponseBytes || TEXT_RESPONSE_MAX_BYTES, (raw) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return fail(createProviderHttpError({
            provider: 'AI 服务',
            operation: '视觉请求',
            status: res.statusCode,
            responseBody: raw,
          }));
        }
        try {
          const json = JSON.parse(raw);
          // 兼容标准 OpenAI 格式与推理模型
          const content = json.choices?.[0]?.message?.content
            || json.choices?.[0]?.message?.reasoning_content
            || null;
          succeed({ status: res.statusCode, body: content, raw });
        } catch (_) {
          succeed({ status: res.statusCode, body: null, raw });
        }
      }, (error) => fail(safeRequestError(error, '视觉请求')));
    });

    req.on('error', (error) => {
      fail(signal?.aborted ? createAbortError(signal) : safeRequestError(error, '视觉请求'));
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      req.destroy();
      fail(createTimeoutError('视觉请求'));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    if (signal?.aborted) {
      onAbort();
      return;
    }
    req.write(bodyStr);
    req.end();
  });
}

/**
 * 图生等长耗时 JSON POST：使用 Node http(s) + 可配置超时（默认 10 分钟），
 * 避免 undici fetch 在慢链路或大包体（多参考图 base64）下长时间挂起后以模糊的 fetch failed 结束。
 * @returns {Promise<{ statusCode: number, raw: string }>}
 */
async function postJSONWithTimeout(url, headers, body, timeoutMs = 600000, networkOptions = {}) {
  const signal = networkOptions.signal;
  throwIfAborted(signal);
  const target = await pinnedRequestTarget(url, networkOptions);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const mod = target.parsed.protocol === 'https:' ? https : http;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const bodyBytes = assertRequestBodyLimit(bodyStr, networkOptions.maxRequestBytes);
    const reqHeaders = {
      'Content-Type': 'application/json',
      'Content-Length': bodyBytes,
      ...headers,
    };
    const options = {
      ...target.requestOptions,
      method: 'POST',
      headers: reqHeaders,
    };

    let settled = false;
    let timer = null;
    let req = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const succeed = (value) => finish(resolve, value);
    const fail = (error) => finish(reject, error);
    const onAbort = () => {
      const error = createAbortError(signal);
      req?.destroy(error);
      fail(error);
    };

    req = mod.request(options, (res) => {
      collectResponse(res, networkOptions.maxResponseBytes || JSON_RESPONSE_MAX_BYTES, (raw) => {
        succeed({ statusCode: res.statusCode || 0, raw });
      }, (e) => {
        fail(signal?.aborted ? createAbortError(signal) : safeRequestError(e, '图片请求'));
      });
    });

    timer = setTimeout(() => {
      req.destroy();
      fail(createTimeoutError('图片生成请求'));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    req.on('error', (e) => {
      fail(signal?.aborted ? createAbortError(signal) : safeRequestError(e, '图片请求'));
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    req.write(bodyStr);
    req.end();
  });
}

/**
 * 用 SSE 流式输出（stream: true）请求 OpenAI 兼容接口。
 * 流式模式下 socket 每收到一个 token 就重置静默计时器，只要模型在生成就不会超时，
 * 彻底解决分镜等长耗时任务的 "fetch failed / timeout" 问题。
 * silenceTimeoutMs：连续多少毫秒无任何数据才判定超时（默认 60 秒）。
 */
async function postJSONStream(url, headers, body, silenceTimeoutMs = 60000, onProgress = null, networkOptions = {}) {
  const signal = networkOptions.signal;
  throwIfAborted(signal);
  const target = await pinnedRequestTarget(url, networkOptions);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const mod = target.parsed.protocol === 'https:' ? https : http;
    // 强制开启流式输出
    const streamBody = { ...body, stream: true };
    const bodyStr = JSON.stringify(streamBody);
    const bodyBytes = assertRequestBodyLimit(bodyStr, networkOptions.maxRequestBytes);
    const reqHeaders = {
      'Content-Type': 'application/json',
      'Content-Length': bodyBytes,
      ...headers,
    };
    const options = {
      ...target.requestOptions,
      method: 'POST',
      headers: reqHeaders,
    };

    let settled = false;
    let silenceTimer = null;
    let req = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (silenceTimer) clearTimeout(silenceTimer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const succeed = (value) => finish(resolve, value);
    const fail = (error) => finish(reject, error);
    const onAbort = () => {
      const error = createAbortError(signal);
      req?.destroy(error);
      fail(error);
    };
    const resetSilenceTimer = () => {
      if (settled) return;
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        req.destroy();
        fail(createTimeoutError('流式输出'));
      }, silenceTimeoutMs);
      if (typeof silenceTimer.unref === 'function') silenceTimer.unref();
    };

    req = mod.request(options, (res) => {
      const statusCode = res.statusCode;
      // 非 2xx 时先读完整 body 再报错（可能是 JSON 错误信息）
      if (statusCode < 200 || statusCode >= 300) {
        collectResponse(res, networkOptions.maxErrorBytes || TEXT_RESPONSE_MAX_BYTES, (raw) => {
          fail(createProviderHttpError({
            provider: 'AI 服务',
            operation: '流式请求',
            status: statusCode,
            responseBody: raw,
          }));
        }, (error) => fail(safeRequestError(error, '流式请求')));
        return;
      }

      let accumulated = '';
      let sseBuffer = '';
      let rawResponse = '';
      let receivedBytes = 0;
      let firstToken = true;
      resetSilenceTimer();

      res.on('data', (chunk) => {
        if (settled) return;
        receivedBytes += chunk.length;
        if (receivedBytes > (networkOptions.maxResponseBytes || STREAM_RESPONSE_MAX_BYTES)) {
          res.destroy(new uploadService.UnsafeMediaReferenceError('AI 流式响应超过大小限制。'));
          return;
        }
        resetSilenceTimer();
        const chunkText = chunk.toString('utf-8');
        rawResponse += chunkText;
        sseBuffer += chunkText;
        // 按行解析 SSE
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop(); // 保留不完整的最后一行
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const evt = JSON.parse(data);
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) {
              if (firstToken) {
                firstToken = false;
                if (onProgress) onProgress(0, 'first_token', '');
              }
              accumulated += delta;
              if (onProgress) onProgress(accumulated.length, null, accumulated);
            }
          } catch (_) { /* 忽略无法解析的行 */ }
        }
      });

      res.on('end', () => {
        if (!accumulated && rawResponse.trim()) {
          try {
            const payload = JSON.parse(rawResponse);
            accumulated = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text || '';
          } catch (_) {}
        }
        succeed({ status: statusCode, body: accumulated });
      });
      res.on('error', (error) => {
        fail(signal?.aborted ? createAbortError(signal) : safeRequestError(error, '流式请求'));
      });
    });

    req.on('error', (error) => {
      fail(signal?.aborted ? createAbortError(signal) : safeRequestError(error, '流式请求'));
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    resetSilenceTimer(); // 连接建立阶段也需要计时
    req.write(bodyStr);
    req.end();
  });
}


module.exports = {
  providerNetworkOptions,
  createAbortError,
  throwIfAborted,
  pinnedRequestTarget,
  postJSONNonStream,
  postJSONWithTimeout,
  postJSONStream,
};
