const baseUrl = process.env.WEB_BASE_URL || 'http://127.0.0.1:3100';

const AUTH_HEADERS = {
  'x-dev-user': process.env.OMNI_DEV_USER || 'e2e',
  'x-dev-role': process.env.OMNI_DEV_ROLE || 'owner',
};

const baseFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const headers = {
    ...(init.headers || {}),
    ...AUTH_HEADERS,
  };
  return baseFetch(input, {
    ...init,
    headers,
  });
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function expectOk(response, label) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} failed (${response.status}): ${body}`);
  }
  return response.json();
}

async function waitForTaskStatus(taskId, expectedStatus, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await expectOk(await fetch(`${baseUrl}/api/tasks/${taskId}`), `get task ${taskId}`);
    if (current.task?.status === expectedStatus) {
      return current.task;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting task ${taskId} => ${expectedStatus}`);
}

function toQuery(params) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (!text) continue;
    sp.set(key, text);
  }
  return sp.toString();
}

async function main() {
  const health = await expectOk(await fetch(`${baseUrl}/api/health`), 'health');
  if (!health.ok) throw new Error('Health endpoint returned ok=false');
  const runActor = `e2e-dead-letter-retry-${Date.now().toString(36)}`;

  const createdEpisode = await expectOk(
    await fetch(`${baseUrl}/api/episodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'E2E Dead Letter Retry' }),
    }),
    'create episode',
  );
  const episodeId = createdEpisode.episode?.id;
  if (!episodeId) throw new Error('Missing episodeId from create episode');

  const createdTaskIds = [];
  for (let i = 0; i < 3; i += 1) {
    const created = await expectOk(
      await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          episodeId,
          type: 'SYSTEM',
          jobKind: 'SYSTEM_FAIL_ALWAYS',
          payload: { slot: i + 1 },
          maxAttempts: 1,
        }),
      }),
      `create fail task ${i + 1}`,
    );
    const taskId = created.task?.id;
    if (!taskId) throw new Error(`Missing task id from fail task ${i + 1}`);
    createdTaskIds.push(taskId);
  }

  for (const taskId of createdTaskIds) {
    const failedTask = await waitForTaskStatus(taskId, 'failed', 45000);
    if (failedTask.error_code !== 'TASK_EXECUTION_FAILED') {
      throw new Error(`Task ${taskId} expected TASK_EXECUTION_FAILED, got ${failedTask.error_code}`);
    }
  }

  const deadLetters = await expectOk(
    await fetch(`${baseUrl}/api/tasks/dead-letters?${toQuery({ episodeId, limit: 50 })}`),
    'list dead letters',
  );
  const matchedDeadLetters = (deadLetters.deadLetters || []).filter(
    (item) =>
      createdTaskIds.includes(item.task_id) &&
      item.dead_reason === 'max_attempts_exceeded' &&
      item.error_code === 'TASK_EXECUTION_FAILED',
  );
  if (matchedDeadLetters.length !== createdTaskIds.length) {
    throw new Error(`Expected ${createdTaskIds.length} matched dead letters, got ${matchedDeadLetters.length}`);
  }

  const previewPage1 = await expectOk(
    await fetch(
      `${baseUrl}/api/tasks/dead-letters/preview?${toQuery({
        episodeId,
        deadReason: 'max_attempts_exceeded',
        errorCode: 'TASK_EXECUTION_FAILED',
        page: 1,
        pageSize: 2,
      })}`,
    ),
    'preview bulk retry dead letters',
  );
  if (!previewPage1.preview || typeof previewPage1.preview.total !== 'number') {
    throw new Error(`Expected preview payload, got ${JSON.stringify(previewPage1)}`);
  }
  if (previewPage1.preview.total !== createdTaskIds.length) {
    throw new Error(`Expected preview total=${createdTaskIds.length}, got ${previewPage1.preview.total}`);
  }
  if (!Array.isArray(previewPage1.preview.taskIds) || previewPage1.preview.taskIds.length !== 2) {
    throw new Error(`Expected preview page1 taskIds.length=2, got ${JSON.stringify(previewPage1.preview)}`);
  }

  const previewPage2 = await expectOk(
    await fetch(
      `${baseUrl}/api/tasks/dead-letters/preview?${toQuery({
        episodeId,
        deadReason: 'max_attempts_exceeded',
        errorCode: 'TASK_EXECUTION_FAILED',
        page: 2,
        pageSize: 2,
      })}`,
    ),
    'preview bulk retry dead letters page2',
  );
  if (!previewPage2.preview || !Array.isArray(previewPage2.preview.taskIds)) {
    throw new Error(`Expected preview page2 payload, got ${JSON.stringify(previewPage2)}`);
  }
  if (previewPage2.preview.taskIds.length !== 1) {
    throw new Error(`Expected preview page2 taskIds.length=1, got ${JSON.stringify(previewPage2.preview)}`);
  }
  if (previewPage2.preview.taskIds.some((taskId) => previewPage1.preview.taskIds.includes(taskId))) {
    throw new Error('Preview pagination returned duplicate task ids across page1/page2');
  }
  for (const taskId of createdTaskIds) {
    const stillFailed = await waitForTaskStatus(taskId, 'failed', 8000);
    if (stillFailed.status !== 'failed') {
      throw new Error(`Task should stay failed after dry-run: ${taskId}`);
    }
  }

  const selectedTaskIds = previewPage1.preview.taskIds.slice();

  const bulkRetry = await expectOk(
    await fetch(`${baseUrl}/api/tasks/dead-letters/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        episodeId,
        deadReason: 'max_attempts_exceeded',
        errorCode: 'TASK_EXECUTION_FAILED',
        limit: 20,
        taskIds: selectedTaskIds,
        actor: runActor,
        reason: 'e2e_verify_bulk_retry_and_audit',
      }),
    }),
    'bulk retry dead letters',
  );

  const batchResult = bulkRetry.result;
  if (!batchResult?.batchId) {
    throw new Error(`Bulk retry missing batchId: ${JSON.stringify(batchResult)}`);
  }
  if (batchResult.mode !== 'executed') {
    throw new Error(`Expected executed mode, got ${batchResult.mode}`);
  }
  if (batchResult.selected !== selectedTaskIds.length || batchResult.retried !== selectedTaskIds.length) {
    throw new Error(`Expected selected/retried=${selectedTaskIds.length}, got ${JSON.stringify(batchResult)}`);
  }
  for (const taskId of selectedTaskIds) {
    if (!batchResult.retriedTaskIds?.includes(taskId)) {
      throw new Error(`Bulk retry result missing task ${taskId}`);
    }
  }
  const untouchedTaskIds = createdTaskIds.filter((taskId) => !selectedTaskIds.includes(taskId));
  for (const taskId of untouchedTaskIds) {
    if (batchResult.retriedTaskIds?.includes(taskId)) {
      throw new Error(`Untouched task ${taskId} should not be retried in selected batch`);
    }
  }

  for (const taskId of createdTaskIds) {
    await waitForTaskStatus(taskId, 'failed', 45000);
  }

  const itemPage1 = await expectOk(
    await fetch(
      `${baseUrl}/api/tasks/ops?${toQuery({
        episodeId,
        auditAction: 'TASK_RETRY_BATCH_ITEM',
        auditActor: runActor,
        auditPage: 1,
        auditPageSize: 2,
      })}`,
    ),
    'ops item page1',
  );

  if (!itemPage1.auditPagination || itemPage1.auditPagination.total < selectedTaskIds.length) {
    throw new Error(`Unexpected audit pagination on page1: ${JSON.stringify(itemPage1.auditPagination)}`);
  }
  if ((itemPage1.recentAuditLogs || []).length === 0) {
    throw new Error('Expected non-empty item audit logs on page1');
  }
  if (!itemPage1.recentAuditLogs.every((item) => item.action === 'TASK_RETRY_BATCH_ITEM')) {
    throw new Error('Found non TASK_RETRY_BATCH_ITEM action in item page1');
  }
  if (!itemPage1.recentAuditLogs.every((item) => String(item.actor || '').includes(runActor))) {
    throw new Error('Found non matching actor in item page1');
  }

  const itemPage2 = await expectOk(
    await fetch(
      `${baseUrl}/api/tasks/ops?${toQuery({
        episodeId,
        auditAction: 'TASK_RETRY_BATCH_ITEM',
        auditActor: runActor,
        auditPage: 2,
        auditPageSize: 2,
      })}`,
    ),
    'ops item page2',
  );
  if ((itemPage1.auditPagination?.hasMore ?? false) && (itemPage2.recentAuditLogs || []).length === 0) {
    throw new Error('Expected page2 logs when page1.hasMore is true');
  }

  const summaryPage = await expectOk(
    await fetch(
      `${baseUrl}/api/tasks/ops?${toQuery({
        episodeId,
        auditAction: 'TASK_RETRY_BATCH_SUMMARY',
        auditActor: runActor,
        auditPage: 1,
        auditPageSize: 5,
      })}`,
    ),
    'ops summary page',
  );
  const summaryHit = (summaryPage.recentAuditLogs || []).some(
    (item) => item.batch_id === batchResult.batchId && item.action === 'TASK_RETRY_BATCH_SUMMARY',
  );
  if (!summaryHit) {
    throw new Error(`Missing summary audit log for batch ${batchResult.batchId}`);
  }

  const exportJson = await expectOk(
    await fetch(
      `${baseUrl}/api/tasks/audit-logs/export?${toQuery({
        episodeId,
        auditActor: runActor,
        batchId: batchResult.batchId,
        limit: 50,
        format: 'json',
      })}`,
    ),
    'export audit json',
  );
  if (!Array.isArray(exportJson.logs) || exportJson.logs.length === 0) {
    throw new Error(`Expected non-empty exported json logs, got ${JSON.stringify(exportJson)}`);
  }
  const exportedItemLogs = exportJson.logs.filter((item) => item.action === 'TASK_RETRY_BATCH_ITEM');
  if (exportedItemLogs.length !== selectedTaskIds.length) {
    throw new Error(`Expected ${selectedTaskIds.length} TASK_RETRY_BATCH_ITEM logs, got ${exportedItemLogs.length}`);
  }
  if (!exportJson.logs.some((item) => item.action === 'TASK_RETRY_BATCH_SUMMARY')) {
    throw new Error('Exported json logs missing TASK_RETRY_BATCH_SUMMARY');
  }

  const exportCsvResponse = await fetch(
    `${baseUrl}/api/tasks/audit-logs/export?${toQuery({
      episodeId,
      auditActor: runActor,
      batchId: batchResult.batchId,
      limit: 50,
      format: 'csv',
    })}`,
  );
  if (!exportCsvResponse.ok) {
    const body = await exportCsvResponse.text();
    throw new Error(`Export audit csv failed (${exportCsvResponse.status}): ${body}`);
  }
  const csv = await exportCsvResponse.text();
  if (!csv.includes('TASK_RETRY_BATCH_SUMMARY')) {
    throw new Error('Exported csv missing TASK_RETRY_BATCH_SUMMARY');
  }
  if (!csv.includes('metadata_json')) {
    throw new Error('Exported csv missing header metadata_json');
  }

  const prune = await expectOk(
    await fetch(`${baseUrl}/api/tasks/audit-logs/prune`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        olderThanDays: 0,
        episodeId,
        auditAction: 'TASK_RETRY_BATCH_ITEM',
        auditActor: runActor,
        limit: 50,
        actor: runActor,
        reason: 'e2e_validate_audit_prune',
      }),
    }),
    'prune audit logs',
  );
  if (!prune.result || prune.result.mode !== 'executed') {
    throw new Error(`Expected executed prune result, got ${JSON.stringify(prune)}`);
  }
  if (prune.result.deleted !== selectedTaskIds.length) {
    throw new Error(`Expected pruned deleted=${selectedTaskIds.length}, got ${JSON.stringify(prune.result)}`);
  }

  const itemPageAfterPrune = await expectOk(
    await fetch(
      `${baseUrl}/api/tasks/ops?${toQuery({
        episodeId,
        auditAction: 'TASK_RETRY_BATCH_ITEM',
        auditActor: runActor,
        auditPage: 1,
        auditPageSize: 5,
      })}`,
    ),
    'ops item page after prune',
  );
  if ((itemPageAfterPrune.auditPagination?.total || 0) !== 0) {
    throw new Error(`Expected no TASK_RETRY_BATCH_ITEM logs after prune, got ${JSON.stringify(itemPageAfterPrune.auditPagination)}`);
  }

  const pruneSummaryPage = await expectOk(
    await fetch(
      `${baseUrl}/api/tasks/ops?${toQuery({
        episodeId,
        auditAction: 'TASK_AUDIT_PRUNE_SUMMARY',
        auditActor: runActor,
        auditPage: 1,
        auditPageSize: 5,
      })}`,
    ),
    'ops prune summary page',
  );
  const pruneSummaryHit = (pruneSummaryPage.recentAuditLogs || []).some(
    (item) => item.batch_id === prune.result.batchId && item.action === 'TASK_AUDIT_PRUNE_SUMMARY',
  );
  if (!pruneSummaryHit) {
    throw new Error(`Missing prune summary audit log for batch ${prune.result.batchId}`);
  }

  console.log('E2E ok', {
    episodeId,
    actor: runActor,
    batchId: batchResult.batchId,
    retried: batchResult.retried,
    itemAuditTotal: itemPage1.auditPagination?.total || 0,
    summaryAuditTotal: summaryPage.auditPagination?.total || 0,
  });
}

main().catch((error) => {
  console.error('E2E failed', error);
  process.exitCode = 1;
});
