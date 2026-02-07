---
status: ARCHIVED
---

# vNext 重构分支开发计划 (Refactor Branch Master Plan)

> 历史文档说明：本目录为分支阶段提案归档，当前实施入口为 `rules.md` 与 `docs/*`。

**分支目标**: 将项目从“UI 原型”升级为“生产级架构”，解决数据分层、渲染安全、任务治理三大阻断性问题，并明确视频能力的复用策略。

**文档清单**:
1.  [01_architecture_audit.md](./01_architecture_audit.md) - **架构审计**: 识别分层缺失与队列隐患。
2.  [02_image_gen_fix.md](./02_image_gen_fix.md) - **图像生成修复**: 解决渲染协议阻断与配置缺失。
3.  [03_video_gen_strategy.md](./03_video_gen_strategy.md) - **视频策略**: 确认复用 `CineFlow` 逻辑，停止重复造轮子。

---

## 1. 核心任务路线图 (Execution Roadmap)

### Phase 1: 基础设施修复 (Infrastructure Fixes)
> **目标**: 让现有的图片能显示，让普通用户能配 Key，让应用跑起来不崩。
- [ ] **P0: 渲染协议注册** (`main.ts`)
    - 注册 `omnidir://` 协议，拦截并安全地服务本地 `output/` 目录下的文件。
    - 解决“图片生成了但前端显示空白”的致命 Bug。
- [ ] **P1: 配置管理 UI** (`ConfigPanel`)
    - 移除对 `.env` 的强依赖。
    - 在前端设置面板增加 API Key 输入框，通过 IPC 安全存储至 `electron-store` (AES 加密)。

### Phase 2: 业务数据重构 (Data Model Refactor)
> **目标**: 引入行业标准分层，提升剧本解析精度与资产一致性。
- [ ] **P0: 数据库升级** (`db/schema`)
    - 引入 `Scene` (场) 与 `Beat` (节拍) 表结构。
    - 迁移路径: `Script -> Shots` (Old) => `Script -> Scenes -> Beats -> Shots` (New)。
- [ ] **P1: 拆解逻辑升级** (`gemini.ts`)
    - 升级 Prompt，采用两段式拆解（先分场，再分镜）。
    - 确保 `Shot` 能够继承 `Scene` 的资产绑定信息。

### Phase 3: 任务队列与 Worker 增强 (Task Queue & Worker)
> **目标**: 实现可恢复、可观测、高可靠的异步任务系统。
- [ ] **P0: 队列归一化**
    - 废弃前端所有直接调用 `geminiService` 的代码。
    - 统一走 `app.task.submit`，实现“断点续传”和“崩溃恢复”。
- [ ] **P1: 逻辑移植 (from CineFlow)**
    - 移植 `construct_enhanced_prompt`：实现 `@characterid` 清洗与资产 Prompt 自动注入。
    - 移植 `Retry/Polling`：实现 API 层的 429/5xx 自动指数退避重试。

### Phase 4: 交付与对账 (Delivery & Manifest)
> **目标**: 让生成结果可交付、可追溯。
- [ ] **P1: 标准化落盘**
    - 路径规范化: `output/{EpisodeID}/shots/{ShotID}/grid_{GridID}/...`
- [ ] **P1: Manifest 生成**
    - 每次生成结束，自动写入 `manifest.json`，记录 Prompt 快照、模型版本、资产引用列表。

---

## 2. 关键决策记录 (Decision Log)

*   **视频生成**: 暂时搁置 UI 开发，后端逻辑将完全复刻 `CineFlow` 的 Python 实现（逻辑移植到 TS），不直接通过 IPC 调用 Python 脚本，以保持部署轻量化。
*   **存储**: 严禁 Base64 入库。所有媒体资源必须落盘，数据库仅存相对路径。
*   **安全**: 前端零密钥。Renderer 进程禁止触碰 API Key，禁止直接读取 `fs`。

---

## 3. 开发规范提醒

*   **新代码原则**: 先写 TS Interface，再写 IPC Handler，最后写 UI 调用。
*   **提交规范**: `feat(refactor): add omnidir protocol`
