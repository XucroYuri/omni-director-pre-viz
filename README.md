<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Omni-Director Pre-viz Workstation

本仓库当前执行主线为 **Phase 9 Web First**（Next.js + Worker + Postgres + MinIO），Electron 侧保留为兼容与迁移期路径。

权威入口（实施与验收以此为准）：
- `docs/README.md`
- `docs/roadmap/Execution-Roadmap-2026.md`
- `docs/roadmap/Phase9-Execution-Detail.md`
- `docs/governance/Risk-Audit-Checklist-2026.md`
- `docs/audit/Legacy-Docs-Ledger.md`
- `rules.md`

历史方案入口（仅用于追溯，不作为默认实施依据）：
- `dev/`
- `dev/archive/`

## 本地运行（开发）
1. 安装依赖：`npm install`
2. 启动基础设施：`npm run phase9:infra:up`
3. 初始化 Web：`npm run phase9:web:setup`
4. 启动 Web + Worker：`npm run phase9:web:dev:with-worker`

访问：
- Web: `http://127.0.0.1:3100`
- Queue Ops Console: `http://127.0.0.1:3100/ops/queue`

如需启动 Electron 兼容链路（legacy）：
- `npm run dev`

## 原生依赖自动重建
项目在 `postinstall` 中自动执行 `npm run setup:native`，等价于：

`electron-builder install-app-deps`

用于按当前 Electron 版本重建原生依赖（例如 `better-sqlite3`），减少 `NODE_MODULE_VERSION` 不匹配导致的启动失败。

如需手动触发：

`npm run setup:native`

## 本地文档治理门禁（pre-push）
可手动执行 `node scripts/setup-git-hooks.cjs`，把本仓库 Git hooks 路径设置为 `.githooks`。  
其中 `pre-push` 会自动运行 `node scripts/docs-governance-audit.cjs`，用于阻断文档状态/索引/旧路径引用回归。

如需手动修复 hooks 配置：

`node scripts/setup-git-hooks.cjs`

## 任务错误链路回归（E2E）

执行：

`npm run test:e2e:task-errors`

该回归会自动构建 Electron 产物并验证以下链路：提交故障任务 -> 队列失败更新 -> `TaskPanel` 可读错误文案（参数缺失 / 资源不存在 / 前置条件不满足）。

Web 侧 dead-letter 批量重试链路可执行：

`npm run test:e2e:web-dead-letter-retry`

该回归会自动拉起 `apps/web` + worker，并校验 dead-letter 批量重试以及审计日志过滤/分页链路。

## Phase 9.1: Web First 本地基建

仓库新增了 `apps/web`（Next.js App Router）和根目录 `docker-compose.yml`（PostgreSQL + MinIO）。
当前 Web API 已包含 `episodes/shots/assets/tasks` 的基础读写与任务状态上报接口。

本地启动命令见上方“本地运行（开发）”。
额外入口：
- MinIO Console: `http://127.0.0.1:9001`（`minioadmin` / `minioadmin`）

清理：
- `npm run phase9:web:clean`（删除 `apps/web/.next`）
- `npm run phase9:web:smoke`（在 web 服务运行时做 API 冒烟）

Worker：
- `npm run phase9:web:worker`（持续轮询 `queued` 任务并自动执行）
- `npm run phase9:web:worker:once`（处理当前队列后退出）
- worker 支持 `TASK_WORKER_CONCURRENCY/TASK_WORKER_INTERVAL_MS/TASK_WORKER_LEASE_MS/TASK_WORKER_HEARTBEAT_MS/TASK_WORKER_RECOVERY_INTERVAL_MS/TASK_WORKER_RECOVERY_BATCH_SIZE/TASK_WORKER_BACKOFF_BASE_MS/TASK_WORKER_BACKOFF_MAX_MS/TASK_WORKER_DEFAULT_KIND_CONCURRENCY/TASK_WORKER_DEFAULT_KIND_RATE_LIMIT_MS/TASK_WORKER_KIND_CONCURRENCY/TASK_WORKER_KIND_RATE_LIMIT_MS` 调参
- worker 支持审计 TTL：`TASK_AUDIT_LOG_TTL_DAYS/TASK_AUDIT_PRUNE_INTERVAL_MS/TASK_AUDIT_PRUNE_BATCH_SIZE`
- 新增 dead-letter 查询：`GET /api/tasks/dead-letters`
- 新增 dead-letter 预览：`GET /api/tasks/dead-letters/preview`（无副作用预览命中，支持分页）
- 新增 dead-letter 批量重试：`POST /api/tasks/dead-letters/retry`（支持过滤条件与 `taskIds` 精准重试）
- 新增运维快照：`GET /api/tasks/ops`
- 运维快照新增 `recentAuditLogs + auditPagination`，支持 `auditAction/auditActor/auditPage/auditPageSize` 查询，并在 `/ops/queue` 提供批量重试审计视图
- 新增审计导出：`GET /api/tasks/audit-logs/export`（`json/csv`）
- 新增审计清理：`POST /api/tasks/audit-logs/prune`（支持 TTL + 筛选 + dry-run）
- `GET /api/health` 现包含 `taskQueue` 指标（queued ready/delayed、running、dead-letter 数量）

## 安装常见问题
1. npm cache 权限报错（`EACCES`）
   - 现象：`~/.npm/_cacache` 下存在无权限文件
   - 处理：`npm install --cache ./.npm-cache`
2. Electron 二进制下载失败（`ENOTFOUND release-assets.githubusercontent.com`）
   - 处理：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install --cache ./.npm-cache`
3. Electron 启动时报 `better-sqlite3` ABI 不匹配（`NODE_MODULE_VERSION`）
   - 处理：先执行 `npm run setup:native`，再重启 `npm run dev`

## 开发环境变量（仅本地）
桌面端生成能力在 Main Process 读取密钥，默认从环境变量/本地 `.env.local` 注入（`.env.example` 提供模板）：
- `AIHUBMIX_API_KEY`

输出目录（开发默认）：
- `app.getPath('userData')/output`（可用 `OMNI_OUTPUT_DIR` 覆盖）

> 注意：不要在前端 bundle/URL/日志中放入任何真实密钥；最终方案会在桌面端主进程中通过“弹窗输入 + 加密持久化 + 设备绑定失效”管理 aihubmix key。
