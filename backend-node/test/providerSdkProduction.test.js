const { it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const configModule = require('../src/config');
const aiConfigService = require('../src/services/aiConfigService');
const workflowService = require('../src/services/workflowService');
const { validateFfmpegTools } = require('../src/utils/ffmpegPath');
const { selectFixtureVideoEncoder } = require('./mediaFixture');

const log = {
  info() {},
  warn() {},
  error() {},
};

function createMediaFixture(ffmpeg, outputPath, type) {
  const args = type === 'video'
    ? [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-shortest', '-t', '1', '-c:v', selectFixtureVideoEncoder(ffmpeg), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', outputPath,
    ]
    : [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:a', 'libmp3lame', '-q:a', '7', outputPath,
    ];
  const result = spawnSync(ffmpeg, args, {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || `${type} fixture generation failed`);
  assert.ok(fs.statSync(outputPath).size > 100, `${type} fixture must not be empty`);
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

it('runs the complete production workflow against local fake media providers', { timeout: 120000 }, async () => {
  const tools = validateFfmpegTools();
  assert.equal(tools.ok, true, tools.error || 'FFmpeg and FFprobe are required');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-provider-e2e-'));
  const sourceRoot = path.join(tempRoot, 'sources');
  const storageRoot = path.join(tempRoot, 'storage');
  const clipPath = path.join(tempRoot, 'clip.mp4');
  const speechPath = path.join(tempRoot, 'speech.mp3');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(storageRoot, { recursive: true });
  createMediaFixture(tools.ffmpeg.path, clipPath, 'video');
  createMediaFixture(tools.ffmpeg.path, speechPath, 'audio');

  const png = await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 3,
      background: { r: 30, g: 96, b: 180 },
    },
  }).png().toBuffer();
  const requestCounts = { text: 0, image: 0, video: 0, tts: 0 };
  const providerRequests = [];
  let baseUrl = '';
  const server = http.createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      requestCounts.text += 1;
      providerRequests.push({ type: 'text', key: request.headers['idempotency-key'] });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '{"approved":true}' } }],
      }));
      return;
    }
    if (request.method === 'POST' && request.url === '/images/generations') {
      requestCounts.image += 1;
      providerRequests.push({ type: 'image', key: request.headers['idempotency-key'] });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        data: [{ url: `data:image/png;base64,${png.toString('base64')}` }],
      }));
      return;
    }
    if (request.method === 'POST' && request.url === '/video/generations') {
      requestCounts.video += 1;
      providerRequests.push({ type: 'video', key: request.headers['idempotency-key'] });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ video_url: `${baseUrl}/clip.mp4` }));
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/audio/speech') {
      requestCounts.tts += 1;
      providerRequests.push({ type: 'tts', key: request.headers['idempotency-key'] });
      response.writeHead(200, { 'content-type': 'audio/mpeg' });
      response.end(fs.readFileSync(speechPath));
      return;
    }
    if (request.method === 'GET' && request.url === '/image.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(png);
      return;
    }
    if (request.method === 'GET' && request.url === '/clip.mp4') {
      response.writeHead(200, { 'content-type': 'video/mp4' });
      response.end(fs.readFileSync(clipPath));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const previousSourceRoot = process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT;
  const originalLoadConfig = configModule.loadConfig;
  const db = new Database(':memory:');
  try {
    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
    const baseConfig = originalLoadConfig();
    configModule.loadConfig = () => ({
      ...baseConfig,
      storage: {
        ...(baseConfig.storage || {}),
        local_path: storageRoot,
        base_url: `${baseUrl}/static`,
      },
    });
    process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT = sourceRoot;

    runMigrationsAndEnsure(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO dramas (id, title, description, style, metadata, status, created_at, updated_at)
       VALUES (1, 'Provider E2E', 'Local fake provider production run', 'cinematic anime', ?, 'draft', ?, ?)`
    ).run(JSON.stringify({ aspect_ratio: '16:9' }), now, now);
    const localProviderSettings = JSON.stringify({ allow_local_http: true });

    aiConfigService.createConfig(db, log, {
      service_type: 'text',
      provider: 'openai_compatible',
      api_protocol: 'openai',
      name: 'Local text fixture',
      base_url: `${baseUrl}/v1`,
      api_key: 'fixture-text-key',
      model: ['fixture-text-model'],
      default_model: 'fixture-text-model',
      endpoint: '/chat/completions',
      is_default: true,
      settings: localProviderSettings,
    });
    aiConfigService.createConfig(db, log, {
      service_type: 'image',
      provider: 'openai_compatible',
      api_protocol: 'openai',
      name: 'Local asset image fixture',
      base_url: baseUrl,
      api_key: 'fixture-asset-image-key',
      model: ['fixture-image-model'],
      default_model: 'fixture-image-model',
      endpoint: '/images/generations',
      is_default: true,
      settings: localProviderSettings,
    });
    aiConfigService.createConfig(db, log, {
      service_type: 'storyboard_image',
      provider: 'openai_compatible',
      api_protocol: 'openai',
      name: 'Local image fixture',
      base_url: baseUrl,
      api_key: 'fixture-image-key',
      model: ['fixture-image-model'],
      default_model: 'fixture-image-model',
      endpoint: '/images/generations',
      is_default: true,
      settings: localProviderSettings,
    });
    aiConfigService.createConfig(db, log, {
      service_type: 'video',
      provider: 'openai_compatible',
      api_protocol: 'openai',
      name: 'Local video fixture',
      base_url: baseUrl,
      api_key: 'fixture-video-key',
      model: ['fixture-video-model'],
      default_model: 'fixture-video-model',
      endpoint: '/video/generations',
      is_default: true,
      settings: localProviderSettings,
    });
    aiConfigService.createConfig(db, log, {
      service_type: 'tts',
      provider: 'openai_compatible',
      api_protocol: 'openai',
      name: 'Local TTS fixture',
      base_url: `${baseUrl}/v1`,
      api_key: 'fixture-tts-key',
      model: ['fixture-tts-model'],
      default_model: 'fixture-tts-model',
      is_default: true,
      settings: JSON.stringify({ timeout_ms: 5000, allow_local_http: true }),
    });

    const run = workflowService.createWorkflowRun(db, log, {
      drama_id: 1,
      type: 'novel2anime',
      source_type: 'storyboard',
      title: 'One-shot fixture',
      text: 'Shot 1: A performer opens the studio door and steps into the light.',
      target_episode_count: 1,
      qa_mode: 'production',
      options: {
        image_size: '320x180',
        aspect_ratio: '16:9',
        resolution: '360p',
        burn_narration_subtitles: false,
        burn_dialogue_audio: false,
      },
    });
    const completed = await workflowService.processWorkflowRun(db, log, run.id);
    const mergeDiagnostics = db.prepare(
      'SELECT id, status, error_msg FROM video_merges ORDER BY id DESC'
    ).all();
    const imageDiagnostics = db.prepare(
      'SELECT id, provider, status, image_url, local_path FROM image_generations ORDER BY id ASC'
    ).all();
    const providerDiagnostics = db.prepare(
      'SELECT provider_type, provider_name, mode, status, error_message FROM provider_invocations WHERE run_id = ? ORDER BY id ASC'
    ).all(run.id);
    assert.equal(
      completed.status,
      'completed',
      `${completed.error || 'production workflow failed'}; requests=${JSON.stringify(requestCounts)}; images=${JSON.stringify(imageDiagnostics)}; providers=${JSON.stringify(providerDiagnostics)}; merges=${JSON.stringify(mergeDiagnostics)}`
    );
    assert.equal(completed.steps.every((step) => step.status === 'completed'), true);

    const invocations = db.prepare(
      `SELECT provider_type, provider_name, mode, status, output_json
         FROM provider_invocations WHERE run_id = ? ORDER BY id ASC`
    ).all(run.id);
    assert.deepEqual(
      new Set(invocations.filter((row) => row.status === 'success').map((row) => row.provider_type)),
      new Set(['text', 'asset_image', 'image', 'video', 'tts', 'compositor'])
    );
    assert.equal(invocations.every((row) => row.mode === 'production'), true);
    assert.equal(invocations.some((row) => /mock/i.test(row.provider_name)), false);

    const mockTimelineItems = db.prepare(
      `SELECT COUNT(*) AS count FROM timeline_items
        WHERE source_path LIKE 'mock://%' OR source_path LIKE 'placeholder://%'`
    ).get().count;
    assert.equal(mockTimelineItems, 0);

    const merge = db.prepare(
      `SELECT * FROM video_merges WHERE drama_id = 1 AND status = 'completed' ORDER BY id DESC LIMIT 1`
    ).get();
    assert.ok(merge?.merged_url);
    assert.ok(fs.existsSync(path.join(storageRoot, merge.merged_url.replace(/\//g, path.sep))));
    const mergeOptions = JSON.parse(merge.merge_options);
    const mergeScenes = JSON.parse(merge.scenes);
    assert.equal(mergeOptions.timeline_plan.schema, 'localminidrama.production_timeline_composite.v1');
    assert.equal(
      mergeOptions.timeline_plan_hash,
      crypto.createHash('sha256').update(JSON.stringify(mergeOptions.timeline_plan), 'utf8').digest('hex')
    );
    assert.equal(mergeOptions.filter_plan.length, mergeScenes.length);
    assert.deepEqual(
      mergeOptions.filter_plan.map((item) => item.storyboard_id),
      mergeScenes.map((scene) => scene.storyboard_id)
    );
    for (const type of ['effect', 'bgm', 'transition']) {
      const track = mergeOptions.timeline_plan.tracks.find((item) => item.type === type);
      assert.equal(track.status, 'unused');
      assert.equal(track.metadata.optional, true);
      assert.equal(track.metadata.usage, 'unused');
      assert.deepEqual(track.items, []);
    }
    const compositorInvocation = db.prepare(
      `SELECT output_json FROM provider_invocations
        WHERE run_id = ? AND provider_type = 'compositor' AND status = 'success'
        ORDER BY id DESC LIMIT 1`
    ).get(run.id);
    const compositorOutput = JSON.parse(compositorInvocation.output_json);
    assert.equal(compositorOutput.timeline_plan_hash, mergeOptions.timeline_plan_hash);
    assert.deepEqual(compositorOutput.timeline_plan, mergeOptions.timeline_plan);
    assert.deepEqual(compositorOutput.filter_plan, mergeOptions.filter_plan);

    const qa = db.prepare(
      `SELECT passed, report_json FROM qa_reports WHERE run_id = ? ORDER BY id DESC LIMIT 1`
    ).get(run.id);
    assert.equal(qa?.passed, 1);
    assert.equal(JSON.parse(qa.report_json).mode, 'production');
    assert.ok(requestCounts.text >= 1);
    assert.ok(requestCounts.image >= 1);
    assert.ok(requestCounts.video >= 1);
    assert.ok(requestCounts.tts >= 1);
    assert.equal(providerRequests.every((request) => typeof request.key === 'string' && request.key.length > 0), true);
    assert.equal(providerRequests.some((request) => request.type === 'image' && request.key.includes(':asset_image:')), true);
    assert.equal(providerRequests.some((request) => request.type === 'image' && request.key.includes(':image:storyboard:')), true);
    assert.equal(providerRequests.some((request) => request.type === 'video' && request.key.includes(':video:storyboard:')), true);
    assert.equal(providerRequests.some((request) => request.type === 'tts' && request.key.includes(':tts:storyboard-')), true);
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS count FROM image_generations WHERE idempotency_key IS NOT NULL AND idempotency_key != ''"
    ).get().count, requestCounts.image);
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS count FROM video_generations WHERE idempotency_key IS NOT NULL AND idempotency_key != ''"
    ).get().count, requestCounts.video);
  } finally {
    configModule.loadConfig = originalLoadConfig;
    if (previousSourceRoot == null) delete process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT;
    else process.env.LOCALMINIDRAMA_TEST_STORY_SOURCE_ROOT = previousSourceRoot;
    db.close();
    await close(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
