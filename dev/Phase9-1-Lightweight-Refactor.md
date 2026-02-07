---
status: REFERENCE
---

# Phase 9.1 Lightweight Refactor (Cleanup Round)

**日期**: 2026-02-07  
**状态**: REFERENCE（历史重构记录）  
**目标**: 在不改变功能语义的前提下，降低 `apps/web` 代码噪音与维护成本。

> 维护说明：本文件保留历史重构记录，后续阶段请参考 `docs/roadmap/Phase9-Execution-Detail.md`。

## 已执行

1. API 路由降噪
- 抽出统一异常入口：`src/lib/api.ts`（`runApi` / `readJsonBody`）。
- 路由仅保留参数校验与响应编排，去除重复 try/catch 和重复 SQL。

2. 数据访问分层
- 新增 `src/lib/repos/*`：
  - `episodes.ts`
  - `shots.ts`
  - `assets.ts`
- 将 SQL 统一下沉到仓储层，便于后续替换 ORM（Prisma/Drizzle）。

3. 初始化与清理脚本
- 新增 `scripts/phase9-web-setup.cjs`（自动复制 env + install + db init）。
- `apps/web/scripts/init-db.mjs` 支持自动读取 `.env.local`。
- 新增 `apps/web/scripts/smoke-api.mjs` 做 API 冒烟。
- 新增 `phase9:web:clean` 清理 `.next`。

4. 仓库卫生
- 新增 `apps/web/.gitignore`（`.next` / `node_modules` / `.env.local`）。

## 验证

- `npm --prefix apps/web run build`：通过。
- `docker compose config`：通过。
- 若 Docker daemon 未启动，`phase9:infra:up` 与 `phase9:web:setup` 的 DB 初始化会按预期失败并提示恢复动作。

## 下一步建议

1. 接入 ORM migration（Prisma 或 Drizzle）替换手写 schema SQL。  
2. 增加 `task` 表和 worker 协议（Phase 9.2 起点）。  
3. 引入 Auth/Org 模型，准备多人协作基线。  
