---
status: REFERENCE
---

# Phase 9 执行计划: Electron -> Next.js Web

**状态**: REFERENCE（已并入 `docs/roadmap/Phase9-Execution-Detail.md`）  
**日期**: 2026-02-07  
**关联 RFC**: `dev/Phase9-Web-First-RFC.md`

> 维护说明：本文件保留历史快照，不再继续更新。Phase 9 的在用执行计划请以 `docs/roadmap/Phase9-Execution-Detail.md` 为准。

---

## 1. 总体策略

采用四阶段迁移，核心原则：
- 双轨运行：新 Web 与旧 Electron 并行一段时间。
- 结构化错误码延续：不丢失当前排障收益。
- 可回滚：每阶段都可独立止损。

---

## 2. 阶段拆解

### Phase 9.1 基础设施落地（1-2 周）

交付：
- 初始化 Next.js 单仓（App Router + TypeScript + Tailwind）。
- 接入 PostgreSQL（Prisma/Drizzle 二选一）并完成基础 schema。
- 接入对象存储（S3/R2 + 本地 MinIO 兼容层）。
- 提供本地 `docker compose`（Postgres + MinIO）。

验收门禁：
- 本地 `next dev` 启动成功。
- 可创建/读取 Episode、Shot、Asset 的最小 API。

---

### Phase 9.2 任务链路迁移（2-3 周）

交付：
- 落地 `task` 表与 worker 消费器。
- 迁移 `TaskRunner` 错误模型为结构化输出：`code/message/context`。
- 保持 `TaskPanel` 文案映射兼容：参数缺失/资源不存在/前置条件不满足。
- 增加回归脚本：任务提交 -> 失败落库 -> UI 显示可读文案。

验收门禁：
- 三类错误码用例稳定通过。
- 任务重试/取消逻辑在 Web 侧可用。

---

### Phase 9.3 协作与权限（2 周）

交付：
- 登录、组织、成员角色（Owner/Editor/Viewer）。
- 项目级权限控制（项目可见性、写入权限）。
- 操作审计日志（谁在何时改了什么）。

验收门禁：
- 两个账号并行编辑同一项目，权限与审计正确。

---

### Phase 9.4 灰度切流与下线 Electron（1-2 周）

交付：
- 数据迁移脚本（SQLite -> Postgres）及校验报告。
- 生产部署到 Vercel（Preview + Production）。
- 灰度切流策略与回滚剧本。
- Electron 入口降级为只读迁移工具或正式退役。

验收门禁：
- 关键路径（脚本拆解、矩阵图、视频任务、导出）在 Web 侧通过。
- 回滚演练一次成功。

---

## 3. 风险审计清单（可删 / 不可删）

### 高优先级

不可删：
- 错误码到可读文案映射层（直接影响排障效率）。
- 任务状态机（queued/running/completed/failed/cancelled）。

可删：
- Electron 专属 IPC 桥接与 preload API（在 Web 切流后删除）。

### 中优先级

不可删：
- 媒体对象 key 与元数据一致性校验。

可删：
- 本地绝对路径依赖（迁移为对象存储 key 后清理）。

### 低优先级

不可删：
- 基础审计日志表。

可删：
- 历史 UI 噪音组件与未触达交互分支（在观测期后清理）。

---

## 4. 执行顺序建议

1. 先做 9.1 + 9.2（技术骨架和任务链路）。  
2. 然后做 9.3（多人协作最小可用）。  
3. 最后做 9.4（迁移与切流）。  

不建议直接跳到“彻底删除 Electron”，会丢失回滚路径。

---

## 5. 回滚策略

- 每阶段保留独立发布标记（git tag + DB migration version）。
- 切流期间保留只读导入器，确保历史工程可恢复。
- 若任务稳定性下降，立即回切旧任务执行链路并保留新库数据快照。
