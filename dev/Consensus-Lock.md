# 跨团队共识锁定协议 (Consensus Lock Protocol)

**版本**: V1.0
**日期**: 2025-12-21
**状态**: **LOCKED (已锁定)**
**签署方**: 
- **C队 (Team C)**: AI Agent 主力开发团队 (基于 GPT-5.2 / CodeX-5.1-Max 等模型)
- **G队 (Team G)**: AI Agent 辅助/参谋/审查团队 (基于 Gemini-3-Pro-Preview 等模型)
- **Maintainer**: @XucroYuri (需求方/最终拍板方/人工最高权限)

---

## 0. 角色定义（Definitions）

- **C队（Team C）**：基于 ChatGPT 相关模型构成的 AI Agent 主力开发团队（模型版本不限；以 `GPT-5.2` 与 `CodeX-5.1-Max` 为主），负责主实施方案推进与代码主线开发。
- **G队（Team G）**：基于 Gemini 相关模型构成的 AI Agent 辅助/参谋/智囊/审查团队（模型版本不限；以 `Gemini-3-Pro-Preview` 为主），负责独立审查、风险提示与补全建议，不作为权威口径来源。
- **Maintainer**：`@XucroYuri`，需求方与最终拍板方，人工操作的最高权限者；对权威文档与合入拥有最终解释权。

---

## 1. 协议目的
本文档作为 Omni-Director Pre-viz 重构项目（Phase 1 Electron 迁移）的**最高共识依据**。任何代码实施、文档修改或架构调整，若与本文档冲突，必须先发起“变更提案”并由三方重新签署，否则一律以本文档为准。

---

## 2. 核心共识口径 (The Locked Consensus)

### 2.1 权威文档层级
1.  **一级权威 (实施标准)**：`dev/Plan-Codex.md` + `rules.md` + `dev/Guardrails.md`
2.  **二级权威 (共识锁定)**：`dev/Consensus-Lock.md` (本文档)
3.  **参考资料 (非权威)**：`dev/Plan-Electron-Standalone.md` (仅供 Electron 打包配置参考)

### 2.2 关键决策锁定 (Key Decisions)

| 领域 | 锁定口径 | 备注 |
| :--- | :--- | :--- |
| **架构形态** | **Electron 本地应用** (Mac/Win/Linux) | 绿色免安装，去中心化 (无 BFF/Redis/Docker) |
| **数据层级** | **Season (入口/资产) -> Episode (作业) -> Scene/Beat -> Shot** | 启动即进入 Season Manager，不直接进编辑器 |
| **AI Provider** | **aihubmix-only** | 禁止直连 Google/OpenAI；禁止多 Provider 自动切换 |
| **视频模型** | **Sora-2 (model: `sora-2`)** | 禁止接入 Veo 或其他模型；ID 需代码锁定 |
| **前端安全** | **Zero-Secret Frontend** | Key 仅存 Main 进程/Keychain；Renderer 禁止接触 Key |
| **旧数据迁移** | **不自动迁移** | 桌面端作为全新安装；提供“旧原型导出 JSON -> 桌面端导入”路径 |
| **并发控制** | **分池限流 + 自动降级** | LLM=10 / IMG=5 / VID=3；遇 429 自动降级并发并冷却恢复 |
| **SQLite 策略** | **预编译优先 + 单实例锁** | 优先用 `better-sqlite3` 预编译包；App 启动强制 `requestSingleInstanceLock` |
| **更新机制** | **手动提示 (MVP)** | 仅检测版本号提示跳转 GitHub Release，暂不做自动热更 |

---

## 3. 实施摘要 (Implementation Summary)

- **Phase 1 (Skeleton)**: 
  - 建立 `main/` (Local Backend) + `renderer/` (UI) 目录结构。
  - 配置 `electron-builder` 支持三端构建 (含预编译依赖处理)。
  - 实现 IPC `invoke` 基础通信与类型定义。
- **Phase 2 (Data)**:
  - 初始化 `season.db` (Global) + `episode.db` (Local)。
  - 实现 `Sidebar` 读取本地文件系统 (`fs-extra`)。
- **Phase 3 (Logic)**:
  - 迁移 `geminiService` 至 Main Process。
  - 落地 `p-queue` 分池队列与持久化。

---

## 4. 变更门禁 (Change Gates)

任何针对上述“锁定口径”的修改，必须满足：
1.  提交修改后的 `dev/Plan-Codex.md` 或 `rules.md` PR。
2.  在 PR 中显式说明“打破了 Consensus-Lock 的某一项”。
3.  获得 Maintainer 的 `Approved` Review。

---

## 5. 签字确认 (Sign-off)

请各方负责人勾选确认：

- [x] **C队负责人 (Main Dev)**: （AI Agent Team C 操作人/对接人）____________ (日期: 2025-12-21)
- [x] **G队负责人 (Co-Pilot)**: （AI Agent Team G 操作人/对接人）____________ (日期: 2025-12-21)
- [x] **Maintainer**: @XucroYuri (日期: 2025-12-21)

> 说明：C队/G队为 AI Agent 团队；此处“负责人/对接人”用于记录对应的人类操作人。若当前阶段仅以“会话共识”锁定口径，可先保持勾选并在后续补齐姓名。

---

## 6. Phase 1 开工前置检查 (Phase 1 Pre-launch Checklist)

- [ ] **GitHub Repo**: 仓库已创建并推送首个基线 commit。
- [ ] **Branch Protection**: `main` 分支已开启 "Require Code Owner Review" 保护。
- [ ] **Gatekeeper**: `maintainer-approved` 标签流程已在团队内宣贯。
