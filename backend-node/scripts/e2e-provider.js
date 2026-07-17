#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const DEFAULT_PORT = 5688;
const MAX_RECORDED_EVENTS = 100;
const STATS_SCHEMA = 'localminidrama.e2e-provider-stats.v1';
const ENDPOINT_KINDS = Object.freeze([
  'health',
  'models',
  'text',
  'image',
  'video',
  'tts',
  'media',
  'unknown',
]);

function assertEnabled(env = process.env) {
  if (env.LOCALMINIDRAMA_E2E_PROVIDER !== '1' || env.NODE_ENV === 'production') {
    throw new Error('The local E2E provider requires LOCALMINIDRAMA_E2E_PROVIDER=1 outside production');
  }
}

function runFfmpeg(args, label, command = process.env.FFMPEG_PATH || 'ffmpeg') {
  const result = spawnSync(command, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${label} fixture generation failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

function hasFixture(filePath) {
  try {
    return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 64;
  } catch (_) {
    return false;
  }
}

function prepareFixtures(root = path.join(os.tmpdir(), 'localminidrama-e2e-provider')) {
  fs.mkdirSync(root, { recursive: true });
  const imagePath = path.join(root, 'frame.png');
  const audioPath = path.join(root, 'speech.mp3');
  const videoPath = path.join(root, 'clip.mp4');

  if (!hasFixture(imagePath)) {
    runFfmpeg([
      '-f', 'lavfi', '-i', 'color=c=0x1f6f78:s=640x360:d=0.1',
      '-frames:v', '1', imagePath,
    ], 'PNG');
  }
  if (!hasFixture(audioPath)) {
    runFfmpeg([
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1',
      '-codec:a', 'libmp3lame', '-b:a', '96k', audioPath,
    ], 'MP3');
  }
  if (!hasFixture(videoPath)) {
    runFfmpeg([
      '-f', 'lavfi', '-i', 'color=c=0x1f6f78:s=640x360:r=24:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100:duration=1',
      '-shortest', '-c:v', 'mpeg4', '-q:v', '5', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', videoPath,
    ], 'MP4');
  }

  return { imagePath, audioPath, videoPath };
}

function json(res, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendFile(res, filePath, contentType) {
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        reject(Object.assign(new Error('request too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (_) {
        reject(Object.assign(new Error('invalid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function authorized(req, token) {
  return req.headers.authorization === `Bearer ${token}`;
}

function emptyEndpointCounts() {
  return Object.fromEntries(ENDPOINT_KINDS.map((kind) => [kind, {
    attempted: 0,
    succeeded: 0,
    failed: 0,
  }]));
}

function createProviderStats(now = () => new Date().toISOString()) {
  let generation = 0;
  let sequence = 0;
  let resetAt = now();
  let calls = emptyEndpointCounts();
  let events = [];

  function begin(kind) {
    const normalizedKind = ENDPOINT_KINDS.includes(kind) ? kind : 'unknown';
    calls[normalizedKind].attempted += 1;
    return normalizedKind;
  }

  function finish(kind, request, statusCode, metadata = {}) {
    const success = statusCode >= 200 && statusCode < 400;
    calls[kind][success ? 'succeeded' : 'failed'] += 1;
    sequence += 1;
    events.push({
      sequence,
      endpoint: kind,
      method: String(request.method || ''),
      path: String(request.url || '').split('?', 1)[0],
      status_code: statusCode,
      success,
      timestamp: now(),
      ...(metadata.model ? { model: String(metadata.model).slice(0, 200) } : {}),
      ...(Number.isFinite(metadata.prompt_chars) ? { prompt_chars: metadata.prompt_chars } : {}),
      ...(Number.isFinite(metadata.input_chars) ? { input_chars: metadata.input_chars } : {}),
    });
    if (events.length > MAX_RECORDED_EVENTS) events = events.slice(-MAX_RECORDED_EVENTS);
  }

  function reset() {
    generation += 1;
    sequence = 0;
    resetAt = now();
    calls = emptyEndpointCounts();
    events = [];
    return snapshot();
  }

  function snapshot() {
    return {
      schema: STATS_SCHEMA,
      generation,
      reset_at: resetAt,
      calls: JSON.parse(JSON.stringify(calls)),
      events: events.map((event) => ({ ...event })),
    };
  }

  return { begin, finish, reset, snapshot };
}

function requestMetadata(kind, body) {
  const model = typeof body?.model === 'string' ? body.model : '';
  if (kind === 'text') {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    return {
      model,
      input_chars: messages.reduce((sum, message) => sum + String(message?.content || '').length, 0),
    };
  }
  if (kind === 'image' || kind === 'video') {
    return { model, prompt_chars: String(body?.prompt || '').length };
  }
  if (kind === 'tts') {
    return { model, input_chars: String(body?.input || '').length };
  }
  return model ? { model } : {};
}

function endpointKind(pathname) {
  if (pathname === '/healthz') return 'health';
  if (pathname === '/v1/models') return 'models';
  if (pathname === '/v1/chat/completions') return 'text';
  if (pathname === '/v1/images/generations') return 'image';
  if (pathname === '/v1/video/generations' || pathname === '/v1/videos') return 'video';
  if (pathname === '/v1/audio/speech') return 'tts';
  if (pathname === '/media/clip.mp4') return 'media';
  return 'unknown';
}

function createProviderServer(options = {}) {
  const token = String(options.token || process.env.E2E_PROVIDER_TOKEN || 'local-e2e-token');
  const fixtures = options.fixtures || prepareFixtures(options.fixtureRoot);
  const stats = options.stats || createProviderStats(options.now);
  const publicBaseUrl = String(
    options.publicBaseUrl || process.env.E2E_PROVIDER_PUBLIC_BASE_URL || `http://e2e-provider:${DEFAULT_PORT}`
  ).replace(/\/$/, '');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, publicBaseUrl);
    if (url.pathname === '/__e2e/stats' && req.method === 'GET') {
      if (!authorized(req, token)) return json(res, 401, { error: { message: 'unauthorized' } });
      return json(res, 200, stats.snapshot());
    }
    if (url.pathname === '/__e2e/reset' && req.method === 'POST') {
      if (!authorized(req, token)) return json(res, 401, { error: { message: 'unauthorized' } });
      return json(res, 200, stats.reset());
    }

    const kind = stats.begin(endpointKind(url.pathname));
    if (req.method === 'GET' && url.pathname === '/healthz') {
      stats.finish(kind, req, 200);
      return json(res, 200, { status: 'ok', service: 'localminidrama-e2e-provider' });
    }
    if (req.method === 'GET' && url.pathname === '/media/clip.mp4') {
      stats.finish(kind, req, 200);
      return sendFile(res, fixtures.videoPath, 'video/mp4');
    }
    if (!authorized(req, token)) {
      stats.finish(kind, req, 401);
      return json(res, 401, { error: { message: 'unauthorized' } });
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      stats.finish(kind, req, 200);
      return json(res, 200, {
        data: [
          { id: 'local-e2e-text' },
          { id: 'local-e2e-image' },
          { id: 'local-e2e-video' },
          { id: 'local-e2e-tts' },
        ],
      });
    }
    if (req.method !== 'POST') {
      stats.finish(kind, req, 404);
      return json(res, 404, { error: { message: 'not found' } });
    }

    try {
      const body = await readJson(req);
      if (url.pathname === '/v1/chat/completions') {
        stats.finish(kind, req, 200, requestMetadata(kind, body));
        return json(res, 200, {
          id: 'local-e2e-chat',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model || 'local-e2e-text',
          choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }
      if (url.pathname === '/v1/images/generations') {
        if (!String(body.prompt || '').trim()) {
          stats.finish(kind, req, 400, requestMetadata(kind, body));
          return json(res, 400, { error: { message: 'prompt required' } });
        }
        const b64 = fs.readFileSync(fixtures.imagePath).toString('base64');
        stats.finish(kind, req, 200, requestMetadata(kind, body));
        return json(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: b64 }] });
      }
      if (url.pathname === '/v1/video/generations' || url.pathname === '/v1/videos') {
        stats.finish(kind, req, 200, requestMetadata(kind, body));
        return json(res, 200, { id: 'local-e2e-video', status: 'completed', video_url: `${publicBaseUrl}/media/clip.mp4` });
      }
      if (url.pathname === '/v1/audio/speech') {
        stats.finish(kind, req, 200, requestMetadata(kind, body));
        return sendFile(res, fixtures.audioPath, 'audio/mpeg');
      }
      stats.finish(kind, req, 404, requestMetadata(kind, body));
      return json(res, 404, { error: { message: 'not found' } });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      stats.finish(kind, req, statusCode);
      if (!res.headersSent) json(res, statusCode, { error: { message: error.message } });
    }
  });
  server.e2eStats = stats;
  return server;
}

async function main() {
  assertEnabled();
  const port = Number(process.env.E2E_PROVIDER_PORT) || DEFAULT_PORT;
  const server = createProviderServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
  process.stdout.write(`LocalMiniDrama E2E provider listening on ${port}\n`);
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  assertEnabled,
  createProviderStats,
  createProviderServer,
  endpointKind,
  prepareFixtures,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
