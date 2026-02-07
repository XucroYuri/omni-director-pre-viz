---
status: REFERENCE
---

# Phase 9.2+: Queue Worker 深化（并发/幂等/重试退避/死信）

**日期**: 2026-02-07  
**状态**: REFERENCE（已并入 `docs/roadmap/Phase9-Execution-Detail.md`）

> 维护说明：本文件保留历史实施记录，不再继续更新。9.2 后续执行与验收请以 `docs/roadmap/Phase9-Execution-Detail.md` 为准。

## 交付内容

1. 任务执行器并发化 + 结构化可观测日志
- 入口：`apps/web/src/worker/index.ts`
- 能力：
  - 并发槽消费（`TASK_WORKER_CONCURRENCY`）
  - 统一 lease token 认领与幂等提交（租约失效后拒绝晚到提交）
  - 结构化 JSON 日志（`task.claimed/task.completed/task.requeued/task.failed`）
  - 心跳续租（`TASK_WORKER_HEARTBEAT_MS`）与过期扫描回收（`TASK_WORKER_RECOVERY_*`）
  - claim 阶段按 `job_kind` 并发配额与速率窗口（`TASK_WORKER_*KIND*`）

2. 统一错误码分层 + 自动重试策略
- 新增 `apps/web/src/lib/taskErrors.ts`
- 标准错误码：
  - `TASK_PAYLOAD_MISSING`
  - `TASK_PAYLOAD_INVALID`
  - `TASK_PAYLOAD_UNSUPPORTED`
  - `TASK_PRECONDITION_FAILED`
  - `TASK_ENTITY_NOT_FOUND`
  - `TASK_EXECUTION_FAILED`
- 自动分流：
  - `TASK_EXECUTION_FAILED` -> 指数退避后重试（直到 `max_attempts`）
  - 其余码 -> 直接终态失败 + dead-letter

3. 任务域数据模型扩展（幂等 + 重试 + 死信）
- `tasks` 表新增：
  - `attempt_count/max_attempts/next_attempt_at/last_attempt_at`
  - `lease_token/lease_expires_at`
  - `trace_id/idempotency_key`
- `task_dead_letters` 表新增（终态不可恢复任务归档）。
- 新增任务 API：
  - `GET/POST /api/tasks`
  - `GET /api/tasks/:taskId`
  - `GET /api/tasks/dead-letters`
  - `GET /api/tasks/ops`（队列运维快照：queue 指标 + job_kind 聚合 + 最近失败与 dead-letter）
  - `POST /api/tasks/:taskId/retry`
  - `POST /api/tasks/:taskId/cancel`
  - `POST /api/tasks/:taskId/report`（保留兼容）

4. 自动执行 smoke 验证（升级）
- `apps/web/scripts/smoke-api.mjs` 升级为校验自动 worker 链路：
  - `SYSTEM_HEALTH_CHECK` 自动 completed
  - `VIDEO_GEN` 自动 failed + `TASK_PAYLOAD_UNSUPPORTED` + dead-letter（`non_retryable`）
  - `retry` 后再次自动消费
  - `SHOT_SET_STATUS` 自动完成并更新 shot 状态
  - `SYSTEM_FAIL_ALWAYS` 在 `maxAttempts=2` 下经历重试后 dead-letter（`max_attempts_exceeded`）

5. Queue Ops Console（9.2.5）
- 页面：`/ops/queue`
- 能力：
  - `job_kind` 维度 queued/running/completed/failed/cancelled/dead-letter 汇总
  - 最近失败任务与 dead-letter 列表
  - 支持 `episodeId/jobKind/traceId` 过滤与任务级重试

6. Dead-letter 批量重试 + 审计日志（9.2.6）
- 新增表：`task_audit_logs`
- 新增接口：
  - `POST /api/tasks/dead-letters/retry`（支持 `episodeId/jobKind/traceId/deadReason/errorCode/taskIds/limit` 过滤）
  - `GET /api/tasks/ops` 返回 `recentAuditLogs`
- 新增能力：
  - dead-letter 批量重试（只重试当前 `failed/cancelled` 的可重试项）
  - 批处理级审计日志（`TASK_RETRY_BATCH_ITEM/TASK_RETRY_BATCH_SKIPPED/TASK_RETRY_BATCH_SUMMARY`）
  - `/ops/queue` 支持批量重试控制面板与审计日志可视化

7. 审计分页/过滤 + 独立 E2E（9.2.7）
- `GET /api/tasks/ops` 支持审计筛选与分页参数：
  - `auditAction`
  - `auditActor`
  - `auditPage`
  - `auditPageSize`
- `/ops/queue` 支持按 `action/actor` 过滤审计日志并翻页查看。
- 新增独立回归：
  - `npm run test:e2e:web-dead-letter-retry`
  - 自动拉起 web + worker，校验 dead-letter 批量重试与审计日志分页/过滤。

8. 批量重试 dry-run + 审计导出（9.2.8）
- `POST /api/tasks/dead-letters/retry` 新增 `dryRun`：
  - `dryRun=true` 仅返回命中任务，不执行状态修改与审计写入。
- `GET /api/tasks/audit-logs/export`：
  - 支持 `json/csv` 导出（可按 `episodeId/jobKind/traceId/auditAction/auditActor/batchId` 过滤）。
- `/ops/queue` 支持：
  - dead-letter 批量重试先预览（Preview Match）再执行。
  - 审计日志按当前过滤条件导出 JSON/CSV。

9. 独立预览接口（9.2.9）
- 新增 `GET /api/tasks/dead-letters/preview`：
  - 与批量重试同过滤条件，但固定无副作用（仅返回命中任务）。
  - 支持 `page/pageSize` 分页查询全部命中 task_id。
- `/ops/queue` 的 `Preview Match` 改为调用该 GET 接口，执行与预览链路彻底分离。

10. 精准批量重试（9.2.10）
- `POST /api/tasks/dead-letters/retry` 新增 `taskIds`：
  - 可配合预览结果按 task_id 精准重试，而不是只按条件范围重试。
  - 若传入 `taskIds` 且未显式指定 `limit`，默认按 `taskIds.length` 执行（上限 500）。
- `/ops/queue` 新增预览列表勾选与“Retry Selected”入口：
  - 支持当前预览页全选/取消。
  - 点击 task_id 可直达 `GET /api/tasks/:taskId` 排查详情。
- `apps/web/scripts/e2e-dead-letter-retry.mjs` 升级：
  - 覆盖预览分页去重验证（page1/page2）。
  - 覆盖按 `taskIds` 精准重试与审计日志条目数校验。

11. 审计日志 TTL 清理（9.2.11）
- 新增 `POST /api/tasks/audit-logs/prune`：
  - 支持 `olderThanDays` + 过滤条件（`episodeId/jobKind/traceId/auditAction/auditActor/batchId`）。
  - 支持 `dryRun` 预演与执行模式。
- worker 新增周期清理回路：
  - `TASK_AUDIT_LOG_TTL_DAYS`（默认 30，0 为禁用）
  - `TASK_AUDIT_PRUNE_INTERVAL_MS`（默认 60000）
  - `TASK_AUDIT_PRUNE_BATCH_SIZE`（默认 500）
- `/ops/queue` 新增审计清理控制（dry-run/execute）。
- `apps/web/scripts/e2e-dead-letter-retry.mjs` 新增断言：
  - 调用审计清理后，`TASK_RETRY_BATCH_ITEM` 审计项被清理。
  - `TASK_AUDIT_PRUNE_SUMMARY` 审计记录可查询。

## 运行命令

- `npm run phase9:web:dev:with-worker`
- `npm run phase9:web:smoke`

## Worker 环境变量

- `TASK_WORKER_CONCURRENCY`（默认 `1`）
- `TASK_WORKER_INTERVAL_MS`（默认 `1500`）
- `TASK_WORKER_LEASE_MS`（默认 `600000`）
- `TASK_WORKER_HEARTBEAT_MS`（默认 `leaseMs / 3`，并夹在 `[1000, leaseMs-500]`）
- `TASK_WORKER_RECOVERY_INTERVAL_MS`（默认 `intervalMs`）
- `TASK_WORKER_RECOVERY_BATCH_SIZE`（默认 `50`）
- `TASK_WORKER_BACKOFF_BASE_MS`（默认 `2000`）
- `TASK_WORKER_BACKOFF_MAX_MS`（默认 `60000`）
- `TASK_WORKER_DEFAULT_KIND_CONCURRENCY`（默认 `TASK_WORKER_CONCURRENCY`）
- `TASK_WORKER_DEFAULT_KIND_RATE_LIMIT_MS`（默认 `0`）
- `TASK_WORKER_KIND_CONCURRENCY`（JSON 映射，如 `{"VIDEO_GEN":1}`）
- `TASK_WORKER_KIND_RATE_LIMIT_MS`（JSON 映射，如 `{"VIDEO_GEN":1200}`）
- `TASK_WORKER_ID`（默认自动生成）

## 后续建议

- 任务 trace 对接统一 dashboard（Grafana/Datadog）
- 审计日志冷数据归档（对象存储）与长期检索
