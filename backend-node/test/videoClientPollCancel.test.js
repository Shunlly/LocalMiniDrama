const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const videoClient = require('../src/services/videoClient');

const providerDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function createCapturingLogger() {
  const entries = [];
  const logger = { entries };
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (message, meta) => entries.push({ level, message, meta });
  }
  return logger;
}

function assertDistinctScopeIds(dramaId, videoGenId, taskId) {
  assert.notEqual(Number(dramaId), Number(videoGenId));
  assert.notEqual(String(dramaId), String(taskId));
  assert.notEqual(String(videoGenId), String(taskId));
}

function assertCancelledError(error) {
  assert.equal(error && error.name, 'AbortError');
  assert.equal(error.code, 'OPERATION_CANCELLED');
  assert.equal(error.message, '视频任务已取消');
  assert.notEqual(error.retryable, true);
  assert.doesNotMatch(String(error.message), /超时/);
  assert.match(String(error.message), /[\u4e00-\u9fff]/);
  return true;
}

function openaiPollConfig(overrides = {}) {
  return {
    provider: 'custom-provider',
    api_protocol: 'openai',
    base_url: 'https://video.example.com/v1',
    query_endpoint: '/videos/{taskId}',
    api_key: 'secret',
    provider_dns_lookup: providerDnsLookup,
    ...overrides,
  };
}

describe('videoClient 轮询取消与超时', () => {
  it('本地 AbortSignal abort 视为取消，不落到超时', async () => {
    const dramaId = 91003;
    const videoGenId = 81001;
    const taskId = 'abort-task-81002';
    assertDistinctScopeIds(dramaId, videoGenId, taskId);

    let fetchCalls = 0;
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => videoClient.pollVideoTask(
        null,
        createCapturingLogger(),
        videoGenId,
        taskId,
        openaiPollConfig({
          drama_id: dramaId,
          fetch_impl: async () => {
            fetchCalls += 1;
            return new Response(JSON.stringify({ status: 'processing' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          },
        }),
        5,
        0,
        controller.signal
      ),
      assertCancelledError
    );
    assert.equal(fetchCalls, 0);
  });

  it('厂商 cancelled/canceled/cancelled_by_user 视为取消，且不会继续轮询到超时', async () => {
    const cases = [
      { status: 'cancelled', dramaId: 91013, videoGenId: 81011, taskId: 'vendor-cancel-81012' },
      { status: 'canceled', dramaId: 91033, videoGenId: 81031, taskId: 'vendor-canceled-81032' },
      { status: 'cancelled_by_user', dramaId: 91043, videoGenId: 81041, taskId: 'vendor-cancel-user-81042' },
    ];

    for (const item of cases) {
      assertDistinctScopeIds(item.dramaId, item.videoGenId, item.taskId);
      let fetchCalls = 0;
      await assert.rejects(
        () => videoClient.pollVideoTask(
          null,
          createCapturingLogger(),
          item.videoGenId,
          item.taskId,
          openaiPollConfig({
            drama_id: item.dramaId,
            fetch_impl: async () => {
              fetchCalls += 1;
              return new Response(JSON.stringify({ status: item.status }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              });
            },
          }),
          4,
          0
        ),
        assertCancelledError
      );
      assert.equal(fetchCalls, 1, item.status);
    }
  });

  it('Sora 适配器抛出的厂商取消不会被 catch 吞成超时', async () => {
    const dramaId = 91053;
    const videoGenId = 81051;
    const taskId = 'sora-cancel-81052';
    assertDistinctScopeIds(dramaId, videoGenId, taskId);

    let fetchCalls = 0;
    await assert.rejects(
      () => videoClient.pollVideoTask(
        null,
        createCapturingLogger(),
        videoGenId,
        taskId,
        {
          provider: 'openai',
          api_protocol: 'sora',
          base_url: 'https://api.openai.example/v1',
          api_key: 'sora-key',
          endpoint: '/v1/videos',
          drama_id: dramaId,
          provider_dns_lookup: providerDnsLookup,
          fetch_impl: async () => {
            fetchCalls += 1;
            return new Response(JSON.stringify({ status: 'cancelled' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          },
        },
        4,
        0
      ),
      assertCancelledError
    );
    assert.equal(fetchCalls, 1);
  });

  it('只有轮询次数耗尽才返回视频生成超时', async () => {
    const dramaId = 91023;
    const videoGenId = 81021;
    const taskId = 'timeout-task-81022';
    assertDistinctScopeIds(dramaId, videoGenId, taskId);

    let fetchCalls = 0;
    const result = await videoClient.pollVideoTask(
      null,
      createCapturingLogger(),
      videoGenId,
      taskId,
      openaiPollConfig({
        drama_id: dramaId,
        fetch_impl: async () => {
          fetchCalls += 1;
          return new Response(JSON.stringify({ status: 'processing' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      }),
      3,
      0
    );

    assert.equal(result.error, '视频生成超时，请稍后重试');
    assert.equal(fetchCalls, 3);
    assert.equal(result.cancelled, undefined);
  });
});
