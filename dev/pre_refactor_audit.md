# 重构前内部审查报告 (Pre-Refactoring Internal Audit)

**日期**: 2025-12-21
**审查对象**: 
- `dev/Plan-Codex.md`（权威实施方案与任务分解）
- `rules.md`（开发规范与硬红线）
- `dev/Guardrails.md`（门禁与锁定范围）
- `dev/Plan-Electron-Standalone.md`（Electron 桌面化/打包参考，非权威）
- `dev/migration_review.md`（现状差距分析，评估快照）

**目的**: 在正式启动 Electron 重构前，确保所有需求方指令已明确，识别潜在风险与模糊地带。

> 共识锁定：见 `dev/Consensus-Lock.md`。本审查报告用于解释“为什么这样拍板”，不取代权威实施标准。

---

## 1. 关键决策确认 (Confirmed Decisions)

以下关键点已根据需方/专家意见达成一致，将在重构中严格执行：

| 决策点 | 确认内容 | 来源 |
| :--- | :--- | :--- |
| **架构形态** | **Electron 本地应用** (Mac/Win/Linux)，绿色免安装，去中心化 (无 BFF/Redis)。 | User Msg 13 |
| **数据层级** | **Episode -> Scene/Beat -> Shot** (实体层)。Season 作为资产共用层与入口。 | User Msg 9, 12 |
| **视频模型** | **仅限 Sora-2** (Model ID: `sora-2`)，通过 aihubmix 调用。禁止 Veo。 | User Msg 12, Rules 4.4.2 |
| **离线策略** | **弱离线模式**：核心 AI 功能依赖网络，但应用框架、资产管理、剧本编辑必须离线可用。 | User Msg 12 |
| **安全红线** | **前端零密钥**：Key 仅存在于主进程/Keychain，禁止前端持有。 | Rules 4.1 |

---

## 2. 已处置的歧义点 (Resolved Ambiguities)

以下细节曾存在歧义，现已与需方拍板收敛为可直接执行的实现口径：

### Q1: 现有原型数据的迁移策略
- **现状**: 当前原型使用 `localStorage` 存储剧本和配置。
- **问题**: 重构为 Electron + SQLite 后，是否需要保留并自动迁移用户在浏览器原型中产生的数据？
- **风险**: 如果用户已在原型中投入大量时间，数据丢失会导致不满。
- **结论（已拍板）**:
  - **不自动迁移（Default）**：新版 Electron 作为全新安装，不尝试读取浏览器 localStorage。
  - **留存方案（必须提供）**：旧原型侧提供“导出 JSON/ZIP”的显式入口；新桌面端支持从导出文件导入（实现细则见 `dev/Plan-Codex.md:5.12`）。

### Q2: "Season" 入口交互形态
- **现状**: 需求方要求 "Season 为初始化入口"，但未提供 UI 设计。
- **问题**: 启动应用时，是直接进入“最近的项目”，还是强制显示“Season 管理器”？
- **结论（已拍板）**：**启动即管理页（Season Manager / Selector）**。
  - 启动后显示 Season/Episode 选择与新建入口；选择后进入主编辑器（对齐 `dev/Plan-Codex.md` 的 `Home → Workspace` 信息架构）。

### Q3: 本地环境的构建依赖
- **问题**: 目标是 "GitHub 开源 + 一键运行"。使用 `better-sqlite3` 需要 native binding，这可能会增加 Windows/Linux 用户的编译门槛（需安装 Python/Visual Studio Build Tools）。
- **风险**: "一键运行" 对开发者环境要求过高。
- **处置（采纳）**：采用“预编译优先 + 兜底文档”的策略：
  - 依赖选择需尽量支持 Electron prebuild；
  - CI/Release 使用 `electron-builder` 的依赖安装步骤（例如 `install-app-deps`）；
  - 补齐 `CONTRIBUTING.md`（若 Windows/Linux 仍需编译环境，明确列出安装步骤）。

---

## 3. 潜在风险预警 (Risk Assessment)

| 风险点 | 描述 | 缓解措施 |
| :--- | :--- | :--- |
| **R1: SQLite 进程锁** | Electron 多窗口（如多开编辑器）可能导致 SQLite 写入冲突。 | **强制单实例锁** (`app.requestSingleInstanceLock()`)，或仅由 Main Process 独占写入。 |
| **R2: API 限流** | 客户端直接调用 aihubmix，若无统一排队，容易触发 429 错误。 | **并发分池 + 自动降级并发 + 冷却期恢复**（已写入 `dev/Plan-Codex.md`）。 |
| **R3: 更新机制** | 绿色版/免安装版通常缺乏自动更新能力。 | 接受 MVP 阶段无自动更新，仅在 UI 提示“新版本可用”并跳转 GitHub Release。 |

---

## 4. 立即行动清单 (Immediate Actions)

在开始 `npm install electron` 之前，请确认：

1.  **[x] 批准 Q1 策略**：不自动迁移浏览器 localStorage；旧原型提供导出，新桌面端支持导入（见 `dev/Plan-Codex.md:5.12`）。
2.  **[x] 批准 Q2 交互**：启动页为 Season Manager/Selector（Home → Workspace）。
3.  **[x] 批准 R1/R3 妥协**：单实例运行（或 Main 独占写入）+ MVP 阶段无自动更新（仅提示新版本并跳转 Release）。

---

**审查结论**: 
上述关键歧义点已全部收敛为“已拍板”的实施口径；**核心技术方案已闭环，无阻碍重构的重大缺陷。** 可以按最新 `dev/Plan-Codex.md` + `rules.md` 进入 Phase 1 开发。
