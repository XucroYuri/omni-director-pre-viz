# Omni Director Web (Phase 9.1 Bootstrap)

## Local setup

1. Start local infra from repo root:

`docker compose up -d`

2. Copy env (first run only):

`cp apps/web/.env.local.example apps/web/.env.local`

3. Install dependencies:

`npm --prefix apps/web install`

4. Initialize schema:

`npm --prefix apps/web run db:init`

5. Start Next.js app:

`npm --prefix apps/web run dev`

App runs on `http://127.0.0.1:3100`.
Queue 运维页：`http://127.0.0.1:3100/ops/queue`

6. Start worker in another terminal:

`npm --prefix apps/web run worker`

## Cleanup

`npm --prefix apps/web run clean`

## API smoke

Run while dev server is up:

`npm --prefix apps/web run smoke:api`

Smoke 会校验自动 worker 执行链路（queued -> running -> completed/failed），请确保 `worker` 已启动。

## Web E2E (dead-letter 批量重试)

先启动 web + worker，然后执行：

`npm --prefix apps/web run e2e:dead-letter-retry`

该用例会校验：
- `SYSTEM_FAIL_ALWAYS` 任务进入 dead-letter
- `GET /api/tasks/dead-letters/preview` 分页预览无副作用
- `POST /api/tasks/dead-letters/retry` 支持按 `taskIds` 精准批量重试
- `GET /api/tasks/ops` 的审计日志过滤与分页（`auditAction/auditActor/auditPage/auditPageSize`）

## Worker tuning (Phase 9.2+)

可选环境变量（默认值）：

- `TASK_WORKER_CONCURRENCY` (`1`)
- `TASK_WORKER_INTERVAL_MS` (`1500`)
- `TASK_WORKER_LEASE_MS` (`600000`)
- `TASK_WORKER_HEARTBEAT_MS` (`leaseMs / 3`, 自动夹在 `[1000, leaseMs-500]`)
- `TASK_WORKER_RECOVERY_INTERVAL_MS` (`intervalMs`)
- `TASK_WORKER_RECOVERY_BATCH_SIZE` (`50`)
- `TASK_WORKER_BACKOFF_BASE_MS` (`2000`)
- `TASK_WORKER_BACKOFF_MAX_MS` (`60000`)
- `TASK_WORKER_DEFAULT_KIND_CONCURRENCY` (默认 `TASK_WORKER_CONCURRENCY`)
- `TASK_WORKER_DEFAULT_KIND_RATE_LIMIT_MS` (默认 `0`)
- `TASK_WORKER_KIND_CONCURRENCY` (JSON 映射，例如 `{"VIDEO_GEN":1,"SYSTEM_SLEEP":1}`)
- `TASK_WORKER_KIND_RATE_LIMIT_MS` (JSON 映射，例如 `{"VIDEO_GEN":1200}`)
- `TASK_WORKER_ID` (默认自动生成 `<pid>-<random>`)
- `TASK_AUDIT_LOG_TTL_DAYS` (默认 `30`，设为 `0` 可禁用 worker 自动清理)
- `TASK_AUDIT_PRUNE_INTERVAL_MS` (默认 `60000`)
- `TASK_AUDIT_PRUNE_BATCH_SIZE` (默认 `500`)

失败分流策略：

- `TASK_EXECUTION_FAILED`：可自动重试（指数退避）直到 `maxAttempts`
- `TASK_PAYLOAD_*`/`TASK_ENTITY_NOT_FOUND`/`TASK_PRECONDITION_FAILED`：直接终态失败并进入 dead-letter
- lease 过期后提交会被拒绝（避免“晚到写入”覆盖恢复流程）
- 队列 claim 阶段支持按 `job_kind` 并发配额与启动速率窗口（全局约束）
- dead-letter 查询：`GET /api/tasks/dead-letters`
- dead-letter 预览：`GET /api/tasks/dead-letters/preview`（无副作用预览命中，支持 `page/pageSize` 分页）
- dead-letter 批量重试：`POST /api/tasks/dead-letters/retry`（支持 `episodeId/jobKind/traceId/deadReason/errorCode/taskIds/limit` 过滤）
- 运维快照包含审计日志：`GET /api/tasks/ops` 返回 `recentAuditLogs + auditPagination`
- 审计导出：`GET /api/tasks/audit-logs/export`（支持 `format=json|csv`）
- 审计清理：`POST /api/tasks/audit-logs/prune`（支持 TTL + 过滤条件 + dry-run）

## Bootstrap API

- `GET /api/health`
- `GET /api/episodes`
- `POST /api/episodes`
- `GET /api/shots?episodeId=<id>`
- `POST /api/shots`
- `GET /api/assets?episodeId=<id>`
- `POST /api/assets`
- `GET /api/tasks?episodeId=<id>&status=<status>`
- `POST /api/tasks`
- `GET /api/tasks/ops?episodeId=<id>&jobKind=<kind>&traceId=<trace>&auditAction=<action>&auditActor=<actor>&auditPage=<n>&auditPageSize=<n>`
- `GET /api/tasks/audit-logs/export?episodeId=<id>&auditAction=<action>&auditActor=<actor>&batchId=<id>&format=<json|csv>&limit=<n>`
- `POST /api/tasks/audit-logs/prune`
- `GET /api/tasks/<taskId>`
- `GET /api/tasks/dead-letters?episodeId=<id>`
- `GET /api/tasks/dead-letters/preview?episodeId=<id>&jobKind=<kind>&traceId=<trace>&deadReason=<reason>&errorCode=<code>&page=<n>&pageSize=<n>`
- `POST /api/tasks/dead-letters/retry`
- `POST /api/tasks/<taskId>/report`
- `POST /api/tasks/<taskId>/cancel`
- `POST /api/tasks/<taskId>/retry`

> `report` 保留为外部执行器兼容入口；本地默认由 `worker` 自动执行队列。
