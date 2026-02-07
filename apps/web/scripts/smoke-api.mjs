const baseUrl = process.env.WEB_BASE_URL || 'http://127.0.0.1:3100';

async function expectOk(response, label) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} failed (${response.status}): ${body}`);
  }
  return response.json();
}

async function waitForTaskStatus(taskId, expected, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await expectOk(await fetch(`${baseUrl}/api/tasks/${taskId}`), `get task ${taskId}`);
    if (current.task?.status === expected) {
      return current.task;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting task ${taskId} => ${expected}. Is worker running?`);
}

async function main() {
  const health = await expectOk(await fetch(`${baseUrl}/api/health`), 'health');
  if (!health.ok) throw new Error('Health endpoint returned ok=false');

  const createdEpisode = await expectOk(
    await fetch(`${baseUrl}/api/episodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Smoke Episode' }),
    }),
    'create episode',
  );

  const episodeId = createdEpisode.episode?.id;
  if (!episodeId) throw new Error('Missing episode id from create episode');

  await expectOk(
    await fetch(`${baseUrl}/api/shots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        episodeId,
        orderIndex: 1,
        originalText: 'Smoke shot',
        visualTranslation: 'Smoke visual',
      }),
    }),
    'create shot',
  );

  await expectOk(
    await fetch(`${baseUrl}/api/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        episodeId,
        type: 'character',
        name: 'Smoke Character',
        description: 'Smoke desc',
      }),
    }),
    'create asset',
  );

  const createdTask = await expectOk(
    await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        episodeId,
        shotId: null,
        type: 'SYSTEM',
        jobKind: 'SYSTEM_HEALTH_CHECK',
        payload: {},
      }),
    }),
    'create health task',
  );

  const healthTaskId = createdTask.task?.id;
  if (!healthTaskId) throw new Error('Missing task id from create health task');
  await waitForTaskStatus(healthTaskId, 'completed');

  const unsupportedTaskCreate = await expectOk(
    await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        episodeId,
        type: 'VIDEO',
        jobKind: 'VIDEO_GEN',
        payload: { inputMode: 'TEXT_ONLY' },
      }),
    }),
    'create unsupported task',
  );
  const unsupportedTaskId = unsupportedTaskCreate.task?.id;
  if (!unsupportedTaskId) throw new Error('Missing task id from create unsupported task');
  const unsupportedFailed = await waitForTaskStatus(unsupportedTaskId, 'failed');
  if (unsupportedFailed.error_code !== 'TASK_PAYLOAD_UNSUPPORTED') {
    throw new Error(`Expected TASK_PAYLOAD_UNSUPPORTED, got ${unsupportedFailed.error_code}`);
  }
  const deadLettersAfterUnsupported = await expectOk(
    await fetch(`${baseUrl}/api/tasks/dead-letters?episodeId=${episodeId}`),
    'dead letters after unsupported',
  );
  if (!deadLettersAfterUnsupported.deadLetters?.some((item) => item.task_id === unsupportedTaskId && item.dead_reason === 'non_retryable')) {
    throw new Error('Unsupported task should be dead-lettered with non_retryable');
  }

  await expectOk(
    await fetch(`${baseUrl}/api/tasks/${unsupportedTaskId}/retry`, {
      method: 'POST',
    }),
    'retry task',
  );
  await waitForTaskStatus(unsupportedTaskId, 'failed');

  const shotStatusTaskCreate = await expectOk(
    await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        episodeId,
        shotId: (await expectOk(await fetch(`${baseUrl}/api/shots?episodeId=${episodeId}`), 'list shots pre status')).shots?.[0]?.id,
        type: 'SYSTEM',
        jobKind: 'SHOT_SET_STATUS',
        payload: { status: 'completed' },
      }),
    }),
    'create shot status task',
  );
  const shotStatusTaskId = shotStatusTaskCreate.task?.id;
  if (!shotStatusTaskId) throw new Error('Missing task id from create shot status task');
  await waitForTaskStatus(shotStatusTaskId, 'completed');

  const retriableFailCreate = await expectOk(
    await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        episodeId,
        type: 'SYSTEM',
        jobKind: 'SYSTEM_FAIL_ALWAYS',
        payload: {},
        maxAttempts: 2,
      }),
    }),
    'create retriable fail task',
  );
  const retriableFailTaskId = retriableFailCreate.task?.id;
  if (!retriableFailTaskId) throw new Error('Missing task id from create retriable fail task');
  const retriableFailed = await waitForTaskStatus(retriableFailTaskId, 'failed');
  if (retriableFailed.error_code !== 'TASK_EXECUTION_FAILED') {
    throw new Error(`Expected TASK_EXECUTION_FAILED, got ${retriableFailed.error_code}`);
  }
  if (retriableFailed.attempt_count !== 2) {
    throw new Error(`Expected retriable failed attempt_count=2, got ${retriableFailed.attempt_count}`);
  }

  const deadLetters = await expectOk(
    await fetch(`${baseUrl}/api/tasks/dead-letters?episodeId=${episodeId}`),
    'dead letters',
  );
  if (!deadLetters.deadLetters?.some((item) => item.task_id === retriableFailTaskId && item.dead_reason === 'max_attempts_exceeded')) {
    throw new Error('Retriable failure should be dead-lettered with max_attempts_exceeded');
  }

  const bulkRetry = await expectOk(
    await fetch(`${baseUrl}/api/tasks/dead-letters/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        episodeId,
        deadReason: 'max_attempts_exceeded',
        errorCode: 'TASK_EXECUTION_FAILED',
        taskIds: [retriableFailTaskId],
        limit: 10,
        actor: 'smoke-test',
        reason: 'smoke_bulk_retry',
      }),
    }),
    'bulk retry dead letters',
  );
  const bulkRetryResult = bulkRetry.result;
  if (!bulkRetryResult || bulkRetryResult.retried < 1 || !bulkRetryResult.retriedTaskIds?.includes(retriableFailTaskId)) {
    throw new Error(`Expected bulk retry to include ${retriableFailTaskId}, got ${JSON.stringify(bulkRetryResult)}`);
  }

  await waitForTaskStatus(retriableFailTaskId, 'failed', 30000);

  const opsAfterBulkRetry = await expectOk(
    await fetch(`${baseUrl}/api/tasks/ops?limit=120`),
    'ops after bulk retry',
  );
  const itemAuditHit = opsAfterBulkRetry.recentAuditLogs?.some(
    (item) =>
      item.batch_id === bulkRetryResult.batchId && item.task_id === retriableFailTaskId && item.action === 'TASK_RETRY_BATCH_ITEM',
  );
  const summaryAuditHit = opsAfterBulkRetry.recentAuditLogs?.some(
    (item) => item.batch_id === bulkRetryResult.batchId && item.action === 'TASK_RETRY_BATCH_SUMMARY',
  );
  if (!itemAuditHit || !summaryAuditHit) {
    throw new Error(`Missing expected batch retry audit logs for batch ${bulkRetryResult.batchId}`);
  }

  const episodes = await expectOk(await fetch(`${baseUrl}/api/episodes`), 'list episodes');
  const shots = await expectOk(await fetch(`${baseUrl}/api/shots?episodeId=${episodeId}`), 'list shots');
  const assets = await expectOk(await fetch(`${baseUrl}/api/assets?episodeId=${episodeId}`), 'list assets');
  const tasks = await expectOk(await fetch(`${baseUrl}/api/tasks?episodeId=${episodeId}`), 'list tasks');
  if (shots.shots?.[0]?.status !== 'completed') {
    throw new Error(`Expected first shot status=completed, got ${shots.shots?.[0]?.status}`);
  }

  console.log('Smoke ok', {
    episodeCount: episodes.episodes?.length ?? 0,
    shotCount: shots.shots?.length ?? 0,
    assetCount: assets.assets?.length ?? 0,
    taskCount: tasks.tasks?.length ?? 0,
  });
}

main().catch((error) => {
  console.error('Smoke failed', error);
  process.exitCode = 1;
});
