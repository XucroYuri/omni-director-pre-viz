# Phase 9 执行细则（Web First）

**更新时间**: 2026-02-07  
**状态**: Active

## 1. 范围
本文件作为 Phase 9 的执行细则，整合以下历史文档的有效内容：
- `dev/Phase9-Web-Migration-Plan.md`
- `dev/Phase9-2-Worker-Kickoff.md`

目标：确保 Web First 迁移、任务执行链路、运维与回滚口径统一。

## 2. 阶段总览

### 2.1 Phase 9.1（已完成）
交付完成：
- Next.js 子应用落地（`apps/web`）。
- 本地基础设施落地（Postgres + MinIO）。
- `episodes/shots/assets/tasks` 最小 API 可运行。

验收已达成：
- 本地可启动并完成最小 CRUD。

### 2.2 Phase 9.2（核心主链已完成，进入强化）
核心完成项：
- 任务状态机：`queued/running/completed/failed/cancelled`。
- worker 自动执行链路：claim/lease/heartbeat/recovery。
- 结构化错误分层：`error_code + message + context`。
- dead-letter 批量重试与审计日志闭环。

已落地迭代（9.2.0 ~ 9.2.11）概要：
1. 并发执行与结构化日志（按 job_kind 控制并发/速率）。
2. 自动重试与不可重试分流（指数退避 + dead-letter）。
3. 任务域模型扩展（attempt/lease/trace/idempotency）。
4. 自动化 smoke 链路覆盖（worker 自动消费验证）。
5. Queue Ops Console 上线（过滤、任务级重试、失败观察）。
6. dead-letter 批量重试 + 审计日志（批次级记录）。
7. 审计过滤/分页 + 独立 E2E。
8. 批量重试 dry-run + 审计导出（json/csv）。
9. dead-letter 独立 preview 接口（执行与预览彻底分离）。
10. `taskIds` 精准批量重试 + 预览勾选重试。
11. 审计 TTL 清理（API + worker 周期清理）。

进行中强化（9.2.12+）：
- 指标体系统一：吞吐、失败率、重试率、dead-letter 增速。
- 批量重试安全闸门：限流、批次上限、强制 dry-run。
- 审计冷数据策略：保留、导出、归档、清理边界。

### 2.3 Phase 9.3（待启动）
- 登录与组织成员模型（Owner/Editor/Viewer）。
- 项目级权限与写入控制。
- 关键操作审计（可检索、可导出）。

### 2.4 Phase 9.4（待启动）
- SQLite -> Postgres 迁移脚本与核验报告。
- 生产部署（Vercel）与灰度策略。
- Electron 降级只读迁移工具或正式退役。

## 3. 验收门禁

### 3.1 任务链路门禁
1. 三类核心错误码文案可读化稳定：
- 参数缺失
- 资源不存在
- 前置条件不满足
2. 失败任务可重试、可取消、可审计。
3. dead-letter 批量重试支持：过滤、预览、精准 taskIds、审计追踪。

### 3.2 回归门禁
1. Electron 排障链路回归：`npm run test:e2e:task-errors`。
2. Web dead-letter 回归：`npm run test:e2e:web-dead-letter-retry`。
3. API 冒烟：`npm run phase9:web:smoke`。

## 4. 风险与删除策略

### 4.1 不可删
- 错误码 -> UI 文案映射层。
- 任务状态机 + lease/heartbeat/recovery。
- dead-letter 与 task_audit_logs 主链。

### 4.2 可删（条件满足后）
- Electron 专属 IPC/preload 适配层（Web 切流稳定后）。
- 重复手动上报逻辑（自动 worker 覆盖后）。
- 失效的本地绝对路径依赖（对象存储 key 全量替换后）。

## 5. 执行顺序
1. 持续完成 9.2.12+ 的可观测性与运维加固。
2. 启动 9.3 协作权限最小闭环。
3. 启动 9.4 迁移与灰度，最后退役 Electron 主职责。

## 6. 回滚策略
1. 每阶段保留独立发布标记（git tag + migration version）。
2. 灰度期间保留只读导入器与数据快照。
3. 若任务稳定性退化，立即回切前一稳定执行链路并保留现场数据。
