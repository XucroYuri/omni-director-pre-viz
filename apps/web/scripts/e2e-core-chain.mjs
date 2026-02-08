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

async function expectOk(response, label) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} failed (${response.status}): ${body}`);
  }
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('application/zip')) {
    return response.arrayBuffer();
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTaskStatus(taskId, expectedStatus, timeoutMs = 60000) {
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

async function main() {
  const health = await expectOk(await fetch(`${baseUrl}/api/health`), 'health');
  if (!health.ok) throw new Error('Health endpoint returned ok=false');

  const createdEpisode = await expectOk(
    await fetch(`${baseUrl}/api/episodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'E2E Core Chain' }),
    }),
    'create episode',
  );
  const episodeId = createdEpisode.episode?.id;
  if (!episodeId) throw new Error('Missing episodeId from create episode');

  await expectOk(
    await fetch(`${baseUrl}/api/episodes/${episodeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        script: ['Shot 1: A corridor in red light', 'Shot 2: Closeup on hands', 'Shot 3: Wide establishing'].join('\n'),
      }),
    }),
    'update episode script',
  );

  const breakdown = await expectOk(
    await fetch(`${baseUrl}/api/episodes/${episodeId}/breakdown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
    'enqueue breakdown',
  );
  const breakdownTaskId = breakdown.task?.id;
  if (!breakdownTaskId) throw new Error('Missing breakdown task id');

  const breakdownDone = await waitForTaskStatus(breakdownTaskId, 'completed', 90000);
  const matrixTaskIds = breakdownDone.result_json?.matrixTaskIds;
  if (!Array.isArray(matrixTaskIds) || matrixTaskIds.length !== 3) {
    throw new Error(`Expected 3 matrix task ids, got ${JSON.stringify(matrixTaskIds)}`);
  }

  for (const taskId of matrixTaskIds) {
    await waitForTaskStatus(taskId, 'completed', 120000);
  }

  const shots = await expectOk(await fetch(`${baseUrl}/api/shots?episodeId=${episodeId}`), 'list shots');
  if (!Array.isArray(shots.shots) || shots.shots.length !== 3) {
    throw new Error(`Expected 3 shots, got ${JSON.stringify(shots)}`);
  }
  if (!shots.shots.every((s) => typeof s.matrix_image_key === 'string' && s.matrix_image_key.includes('/matrix/mother.png'))) {
    throw new Error('Expected every shot to have matrix_image_key set');
  }

  const zipBytes = await expectOk(await fetch(`${baseUrl}/api/episodes/${episodeId}/export`), 'export zip');
  if (!(zipBytes instanceof ArrayBuffer) || zipBytes.byteLength < 200) {
    throw new Error(`Expected non-empty zip ArrayBuffer, got ${zipBytes?.byteLength}`);
  }

  console.log('E2E core chain ok', {
    episodeId,
    breakdownTaskId,
    matrixTaskCount: matrixTaskIds.length,
    zipSize: zipBytes.byteLength,
  });
}

main().catch((error) => {
  console.error('E2E core chain failed', error);
  process.exitCode = 1;
});
