---
status: REFERENCE
---

# Phase 9 RFC: Web-First 架构替代 Electron

**状态**: REFERENCE（已并入 `docs/roadmap/Phase9-Execution-Detail.md`）  
**作者**: G-Team (Implementation)  
**日期**: 2026-02-07  
**目标**: 用 Next.js 前后端一体化架构替代 Electron，本地与云端统一运行模型，支持团队协作。

> 维护说明：本 RFC 保留为历史设计背景，后续执行与验收以 `docs/roadmap/Phase9-Execution-Detail.md` 为准。

---

## 1. 背景与问题

当前 Electron 架构在以下方面持续产生维护成本：
- 主进程/预加载/渲染三层边界复杂，IPC 容易产生死路径与重复注册风险。
- `better-sqlite3` 与 `sharp` 原生模块对 Node/Electron ABI 敏感，安装和升级稳定性差。
- 单机状态天然弱协作，难以支持多人并发编辑、共享任务与统一审计。

---

## 2. 目标与非目标

### 2.1 目标
- 统一为 Web First：同一套代码支持本地运行和云端部署。
- 采用 Next.js（App Router）实现前后端一体。
- 数据层升级为多用户友好：PostgreSQL + 对象存储。
- 支持团队协作：身份体系、权限、并发编辑、任务队列可观测。
- 默认部署目标 Vercel，降低运维复杂度。

### 2.2 非目标
- 不在同一迭代内重做全部 UI 风格。
- 不在首期引入复杂微服务拆分。
- 不强行一次性迁移历史全部数据，先支持增量迁移。

---

## 3. 目标架构（建议）

1. Web 框架  
- Next.js 16（App Router, Route Handlers, Server Actions）。

2. 数据与存储  
- PostgreSQL（建议 Neon / Supabase Postgres；本地用 Docker Postgres）。  
- 对象存储（建议 S3/R2；本地用 MinIO 兼容 S3 API）。

3. 认证与协作  
- Auth.js 或 Clerk（支持组织、成员、角色）。  
- 协作元数据进入 DB（project/member/lock/activity）。

4. 异步任务与媒体工作流  
- 任务表 + 队列消费者（Inngest 或 QStash/Upstash Redis）。  
- 长任务状态通过 DB 轮询或 SSE 推送到前端。

5. 部署与运行  
- 云端：Vercel（Web/API）+ 托管 Postgres + 托管对象存储。  
- 本地：`docker compose` 一键拉起 Postgres + MinIO + 可选 Redis，Next.js 本地启动。

---

## 4. 关键模块映射（现状 -> 新架构）

1. `TaskQueue` / `TaskRunner`  
- 现状：Electron Main 内存队列。  
- 迁移：持久化任务表 + worker 消费 + 结构化错误码保留。

2. `dbService` + SQLite Repo  
- 现状：本地 SQLite + Repo。  
- 迁移：Prisma/Drizzle + PostgreSQL，保留同等实体语义（episode/shot/asset/task）。

3. 媒体文件  
- 现状：本地磁盘路径。  
- 迁移：对象存储 key + 签名 URL，前端永远不直接依赖本机绝对路径。

4. `TaskPanel` 错误展示  
- 现状：读取 `TaskRunner` message 并解析错误码。  
- 迁移：API 返回结构化 `{ code, message, context }`，前端映射保持兼容。

---

## 5. 本地与云端统一运行模型

1. 本地开发模式  
- `docker compose up -d` 启动 Postgres + MinIO。  
- `next dev` 启动应用。  
- `.env.local` 指向本地服务（S3 endpoint 指向 MinIO）。

2. 云端部署模式  
- Vercel 托管 Next.js。  
- 环境变量切换到生产 Postgres/S3。  
- Worker 可先同仓部署（Vercel cron/queue provider）后续再拆分。

---

## 6. 风险评估

高风险：
- 历史 SQLite 数据迁移到 Postgres 的一致性与幂等处理。
- 媒体路径模型变化（本地绝对路径 -> 对象存储 key）。

中风险：
- 长任务执行时限与重试策略设计不当会导致重复生成。
- 并发编辑冲突（同一 shot 同时修改）。

低风险：
- UI 组件迁移（React 组件大多可复用）。

---

## 7. 决策建议

建议接受 Web First 迁移，并按“先并行、后切流”策略执行：
- 第一步先搭新 Web 后端骨架与数据模型。
- 第二步迁移任务链路和错误码体系。
- 第三步做灰度切流并最终下线 Electron 主流程。

配套执行计划见 `docs/roadmap/Phase9-Execution-Detail.md`。
