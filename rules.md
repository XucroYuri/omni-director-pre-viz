# 项目开发规范（Web First 版）

**版本**: 2026-02-07  
**适用范围**: Omni-Director Pre-viz（Next.js + Worker + Postgres + Object Storage）

本文件定义项目的工程红线、实施约束与验收门禁。出现冲突时，按以下优先级处理：
1. `rules.md`（本文件）
2. `docs/roadmap/Execution-Roadmap-2026.md`
3. `docs/roadmap/Phase9-Execution-Detail.md`
4. `docs/governance/Risk-Audit-Checklist-2026.md`

历史文档（`dev/*`）仅用于追溯，不作为默认实施依据。

---

## 1. 北极星目标

1. 统一运行模型：同一套 Web 应用可本地运行，也可云端部署。
2. 统一任务模型：所有生成任务进入持久化队列并由 worker 执行。
3. 统一数据模型：结构化数据入 Postgres，媒体入对象存储（本地可用 MinIO）。
4. 统一排障模型：错误结构化、状态可观测、链路可审计、任务可恢复。

---

## 2. 架构基线（必须遵守）

### 2.1 应用分层
1. UI 层：Next.js 页面与交互。
2. API 层：Route Handlers/Server Actions（参数校验、鉴权、编排）。
3. Worker 层：异步执行、重试退避、dead-letter、审计写入。
4. 数据层：Postgres + Object Storage（S3 兼容）。

### 2.2 本地与云端同构
1. 本地开发：`docker compose` 拉起 Postgres + MinIO。
2. 云端部署：Vercel + 托管 Postgres + 对象存储。
3. 禁止实现“仅本地可跑”或“仅云端可跑”的分叉逻辑。

---

## 3. 安全红线（Critical）

### 3.1 Zero-Secret Frontend
1. 禁止把任何 Provider Key 注入前端 bundle。
2. 禁止把 key 写入 URL、LocalStorage、IndexedDB、明文日志。
3. 所有 LLM/Image/Video 调用必须在服务端或 worker 执行。

### 3.2 Provider Source 锁定（aihubmix-only）
1. 只允许调用：
- `https://aihubmix.com/gemini`
- `https://aihubmix.com/v1`
2. 禁止直连 Google/OpenAI 官方端点。

### 3.3 模型 ID 锁定
1. 模型 ID 必须集中定义且带锁定注释。
2. 当前锁定值：
- TEXT: `gemini-3-flash-preview`
- IMAGE: `gemini-3-pro-image-preview`
- VIDEO: `sora-2`
3. 任何模型 ID 变更必须走维护者审批。

### 3.4 API Key 生命周期
1. 交付产物不得包含真实 key。
2. key 缺失或校验失败时，生成能力必须阻断。
3. key 需加密持久化，设备变化需强制重新绑定。

---

## 4. 业务与生成链路红线

### 4.1 数据与语义层级
1. 核心作业单元：Episode。
2. 内部拆解：`Script -> Scene/Beat -> Shot -> Angle`。
3. Beat 为主、Scene 为辅，禁止仅用粗粒度切分替代 Beat。

### 4.2 矩阵生成主路径
1. 唯一主路径：`1 次生成 1 张 3x3 母图 -> 物理切片 9 张`。
2. 禁止把九机位实现成 9 次独立绘图调用（单 Angle 修正除外）。
3. 画幅白名单仅允许：`16:9`、`9:16`。

### 4.3 风格与一致性
1. 图片与视频必须使用独立 Style Preset。
2. Angle 文本保持 style-free，Style 在顶层统一注入。
3. 生成前强制校验资产绑定（至少 1 角色 + 1 场景，豁免需显式标记）。
4. 参考图必须配套 Ref Semantics（用途与约束可读、可追溯）。

### 4.4 交付标准
1. 输出必须可追溯：命名规范 + `manifest.json` + ZIP。
2. 输出目录按项目层级聚合，不允许散落临时路径。

---

## 5. 任务系统与错误分层

### 5.1 任务状态机
必须完整支持：
- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

### 5.2 Worker 可靠性
必须包含：
1. lease token + 心跳续租。
2. 过期任务回收与恢复。
3. 幂等提交与晚到写入拒绝。
4. 指数退避重试与最大重试上限。

### 5.3 错误码规范
1. 错误统一结构：`{ code, message, context }`。
2. UI 必须映射核心可读文案（例如：参数缺失/资源不存在/前置条件不满足）。
3. 不可重试错误直接 dead-letter；可重试错误按策略回队列。

### 5.4 dead-letter 与审计
1. dead-letter 批量重试必须支持：过滤、预览、精准 taskIds。
2. 审计日志必须记录：执行动作、操作者、批次、结果、跳过原因。
3. 审计日志必须支持：过滤、分页、导出、TTL 清理。

---

## 6. 可观测性与运维门禁

### 6.1 必备观测指标
1. 任务吞吐、成功率、失败率。
2. 重试率、平均重试次数。
3. dead-letter 增速与积压量。
4. worker 健康（认领延迟、执行延迟、租约恢复次数）。

### 6.2 运维能力
1. `/ops/queue` 必须可用于故障定位与批量处置。
2. 批量重试建议默认支持 dry-run 预演。
3. 关键运维动作必须可审计追踪。

---

## 7. 质量门禁（DoD）

### 7.1 回归门禁
每次影响任务链路的改动至少通过：
1. `npm run test:e2e:task-errors`
2. `npm run test:e2e:web-dead-letter-retry`
3. `npm run phase9:web:smoke`

### 7.2 代码门禁
1. 禁止引入未使用分支与死路径（提交前自检）。
2. 关键变更必须附最小回滚说明。
3. 新增接口必须有输入校验与错误码映射。

---

## 8. 协作与变更管理

1. 新计划与执行文档统一写入 `docs/`，禁止新增 `dev/*` 权威计划。
2. 触及高风险项时，优先做可观测性加固，避免直接删除核心逻辑。
3. 删除逻辑前必须满足 Delete Gate：
- 有替代链路或确认无需替代。
- 有自动回归覆盖。
- 有失败回滚路径。

---

## 9. 发布与迁移约束

1. 迁移期保持可回滚，不得一次性移除全部 Electron 兼容能力。
2. 当 Web 主链路稳定并完成迁移验收后，再退役 Electron 主职责。
3. 切流时必须保留数据快照与回切剧本。

---

## 10. 维护说明

1. 本文件由维护者持续更新。
2. 每次阶段跃迁（如 9.2 -> 9.3）必须同步更新本文件与 `docs/roadmap/*`。
