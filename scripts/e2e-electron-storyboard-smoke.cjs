#!/usr/bin/env node
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { app } = require('electron');

function nowId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function countRuntimeKeys(runtime) {
  return Object.values(runtime?.providers || {}).reduce((acc, provider) => {
    const count = Array.isArray(provider?.apiKeys) ? provider.apiKeys.filter((item) => String(item || '').trim()).length : 0;
    return acc + count;
  }, 0);
}

async function withTimeout(label, promise, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function runStep(label, work, timeoutMs) {
  const start = Date.now();
  console.log(`[smoke] start: ${label}`);
  const result = await withTimeout(label, work(), timeoutMs);
  console.log(`[smoke] done: ${label} (${Date.now() - start}ms)`);
  return result;
}

async function waitForTaskFinal(taskRepo, taskId, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = taskRepo.get(taskId);
    if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) {
      return task;
    }
    await sleep(180);
  }
  throw new Error(`Timeout waiting for task final status: ${taskId}`);
}

async function main() {
  const aiTimeoutMs = Number(process.env.ELECTRON_SMOKE_AI_TIMEOUT_MS || 120_000);
  const queueTimeoutMs = Number(process.env.ELECTRON_SMOKE_QUEUE_TIMEOUT_MS || 30_000);
  console.log(`[smoke] config: aiTimeoutMs=${aiTimeoutMs}, queueTimeoutMs=${queueTimeoutMs}`);

  const defaultUserData = app.getPath('userData');
  const smokeUserData = path.join(os.tmpdir(), nowId('omni-electron-smoke'));
  fs.mkdirSync(smokeUserData, { recursive: true });

  const runtimeEnvSources = [
    path.join(defaultUserData, 'runtime-env.json'),
    path.join(process.env.HOME || '', 'Library', 'Application Support', 'omni-director-pre-viz', 'runtime-env.json'),
  ].filter(Boolean);
  const runtimeEnvSource = runtimeEnvSources.find((candidate) => fs.existsSync(candidate));
  const runtimeEnvTarget = path.join(smokeUserData, 'runtime-env.json');
  if (runtimeEnvSource && fs.existsSync(runtimeEnvSource)) {
    fs.copyFileSync(runtimeEnvSource, runtimeEnvTarget);
  }

  app.setPath('userData', smokeUserData);
  process.env.OMNI_OUTPUT_DIR = path.join(smokeUserData, 'output');

  await app.whenReady();

  const { DEFAULT_STYLE } = require('../dist/shared/constants');
  const { ensurePromptListLength, getGridCellCount, normalizeGridLayout } = require('../dist/shared/utils');
  const { getRuntimeEnvConfig } = require('../dist/main/services/runtimeEnvService');
  const { breakdownScript, generateGridImage, generateMatrixPrompts } = require('../dist/main/providers/aihubmix/gemini');
  const { dbService } = require('../dist/main/services/dbService');
  const { taskRepo } = require('../dist/main/db/repos/taskRepo');
  const { taskQueue } = require('../dist/main/queue/TaskQueue');

  const runtime = getRuntimeEnvConfig();
  const runtimeKeyCount = countRuntimeKeys(runtime);
  if (runtimeKeyCount === 0) {
    throw new Error(
      `No API keys found in runtime env (${runtimeEnvTarget}). Please configure key in Electron settings first.`,
    );
  }

  const script = [
    'EXT. INDUSTRIAL STREET - NIGHT',
    '雨夜中，主角沿着闪烁霓虹的街道奔跑，镜头快速跟拍。',
    '',
    'INT. ABANDONED WAREHOUSE - CONTINUOUS',
    '主角推门而入，手电光束扫过破旧货架，空气中有尘雾漂浮。',
    '',
    'INT. WAREHOUSE PLATFORM - MOMENTS LATER',
    '追击者出现在高台，主角抬头对峙，气氛骤然紧绷。',
  ].join('\n');

  const config = {
    artStyle: DEFAULT_STYLE,
    aspectRatio: '16:9',
    resolution: '1K',
    apiProvider: runtime.apiProvider || 'auto',
    characters: [
      {
        id: nowId('char'),
        name: '主角',
        description: '黑色风衣侦探，冷静克制，雨夜动作戏主视角。',
        tags: ['Smoke'],
      },
    ],
    scenes: [
      {
        id: nowId('scene'),
        name: '雨夜工业街与仓库',
        description: '霓虹反光路面、废弃仓库、冷色雾气、压迫光比。',
        tags: ['Smoke'],
      },
    ],
    props: [
      {
        id: nowId('prop'),
        name: '战术手电',
        description: '金属手电，冷白锥形光束，雨夜高反差照明。',
        tags: ['Smoke'],
      },
    ],
  };

  const breakdown = await runStep(
    'breakdownScript',
    () => breakdownScript(script, config),
    aiTimeoutMs,
  );
  assert.ok(Array.isArray(breakdown.shots) && breakdown.shots.length > 0, 'breakdown returned no shots');

  const selected = breakdown.shots[0];
  const gridLayout = normalizeGridLayout({ rows: 2, cols: 2 });
  const cellCount = getGridCellCount(gridLayout);
  const shotId = nowId('shot');

  const shot = {
    ...selected,
    id: shotId,
    gridLayout,
    status: 'pending',
    sceneIds: [config.scenes[0].id],
    characterIds: [config.characters[0].id],
    propIds: [config.props[0].id],
    matrixPrompts: ensurePromptListLength(selected.matrixPrompts, gridLayout),
    splitImages: [],
    videoUrls: Array(cellCount).fill(null),
    videoStatus: Array(cellCount).fill('idle'),
    animaticVideoUrl: undefined,
    assetVideoUrl: undefined,
  };

  const generatedPrompts = await runStep(
    'generateMatrixPrompts',
    () => generateMatrixPrompts(shot, config),
    aiTimeoutMs,
  );
  shot.matrixPrompts = ensurePromptListLength(generatedPrompts, gridLayout);

  const generatedGrid = await runStep(
    'generateGridImage',
    () => generateGridImage(shot, config),
    aiTimeoutMs,
  );
  assert.ok(generatedGrid?.path && fs.existsSync(generatedGrid.path), 'storyboard image not generated');

  shot.generatedImageUrl = generatedGrid.path;
  shot.status = 'completed';

  const episodeId = nowId('ep_smoke');
  await dbService.saveEpisodeFull({
    episodeId,
    title: 'Electron Storyboard Smoke',
    script,
    context: breakdown.context || '',
    scriptOverview: breakdown.scriptOverview || '',
    sceneTable: breakdown.sceneTable || [],
    beatTable: breakdown.beatTable || [],
    config,
    shots: [shot],
    assets: {
      characters: config.characters,
      scenes: config.scenes,
      props: config.props,
    },
  });

  const loadedEpisode = await dbService.loadEpisode(episodeId, { mediaFormat: 'url' });
  assert.ok(loadedEpisode && loadedEpisode.shots.length === 1, 'episode load verification failed');

  let videoTaskId = '';
  const videoTaskStatusTrail = [];
  const originalUpdateTask = taskQueue.updateTask.bind(taskQueue);
  taskQueue.updateTask = (task) => {
    if (task.id === videoTaskId) {
      videoTaskStatusTrail.push(task.status);
    }
    return originalUpdateTask(task);
  };

  const originalExecute = taskQueue.runner.execute.bind(taskQueue.runner);
  taskQueue.runner.execute = async (task, signal) => {
    let payload = {};
    try {
      payload = JSON.parse(task.payload_json || '{}');
    } catch {
      payload = {};
    }
    if (payload.jobKind === 'VIDEO_GEN') {
      await sleep(150);
      task.result_json = JSON.stringify({
        smoke: true,
        mode: 'enqueue-validation',
        skippedRemoteGeneration: true,
      });
      return;
    }
    return originalExecute(task, signal);
  };

  const now = Date.now();
  videoTaskId = nowId('task_video');
  const videoTask = {
    id: videoTaskId,
    episode_id: episodeId,
    shot_id: shot.id,
    type: 'VIDEO',
    status: 'queued',
    progress: 0,
    payload_json: JSON.stringify({
      jobKind: 'VIDEO_GEN',
      episodeId,
      shotId: shot.id,
      inputMode: 'MATRIX_FRAME',
      prompt: 'Smoke enqueue validation only',
    }),
    result_json: '',
    error: null,
    created_at: now,
    updated_at: now,
  };

  taskQueue.enqueue(videoTask);
  const finalTask = await runStep(
    'waitForVideoTaskFinal',
    () => waitForTaskFinal(taskRepo, videoTaskId, queueTimeoutMs),
    queueTimeoutMs,
  );

  taskQueue.updateTask = originalUpdateTask;
  taskQueue.runner.execute = originalExecute;

  const summary = {
    ok: true,
    smokeUserData,
    runtimeApiProvider: runtime.apiProvider,
    runtimeKeyCount,
    breakdown: {
      shotCount: breakdown.shots.length,
      selectedShotId: selected.id,
    },
    storyboard: {
      generatedImagePath: generatedGrid.path,
      gridLayout,
      panelCount: cellCount,
      promptCount: shot.matrixPrompts.length,
    },
    videoQueue: {
      taskId: videoTaskId,
      statusTrail: videoTaskStatusTrail,
      finalStatus: finalTask.status,
      finalError: finalTask.error,
      resultJsonLength: String(finalTask.result_json || '').length,
    },
  };

  console.log('ELECTRON_SMOKE_RESULT_START');
  console.log(JSON.stringify(summary, null, 2));
  console.log('ELECTRON_SMOKE_RESULT_END');

  await app.quit();
}

main().catch(async (error) => {
  console.error('Electron storyboard smoke failed:', error);
  try {
    await app.quit();
  } catch {}
  process.exitCode = 1;
});
