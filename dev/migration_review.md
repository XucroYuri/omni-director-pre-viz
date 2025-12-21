# 项目全量代码审查与迁移评估报告 (Code Review & Migration Assessment)

**日期**: 2025-12-20
**基准计划**: `dev/Plan-Codex.md` (vNext：Electron + SQLite + Local-first + 前后端分离)
**基准规范**: `rules.md` + `dev/Guardrails.md`（红线 + 门禁）
**协作标准**: `dev/reference_vibe-coding-skill/Vibe-Coding-Standard.md`（PM/Agent 输入与交付模板）
**当前状态**: React SPA (Vite) / Browser-based

> 注：本报告为 2025-12-20 的评估快照；其后的“需方拍板项”已在 `dev/Plan-Codex.md` 与 `rules.md` 收敛并更新（例如：并发分池 `LLM=10/IMG=5/VID=3`、命名 `Angle_{01-09}`、Key 设备绑定与不随交付产物分发等）。实施与验收以最新 `dev/Plan-Codex.md` / `rules.md` 为准。

---

## 1. 总体评估 (Executive Summary)

当前代码库是一个纯 Web 前端项目 (React + Vite)，完全运行在浏览器环境中。虽然核心业务逻辑（剧本拆解、九宫格生成、物理切片）已在前端跑通，但与目标架构 **"Electron 本地一键运行客户端"** 存在 **100% 的架构差距**。

目前项目处于 **"Web 原型 (Prototype)"** 阶段，尚未开始任何 Electron 相关的容器化工作。数据持久化依赖不稳定的 `localStorage`，大文件处理依赖内存 Blob，不符合“生产力工具”的稳定性要求。

**核心差距概览**:
1.  **架构**: Web SPA vs Electron Desktop (缺失 Main Process, IPC, FS, SQLite)。
2.  **数据**: LocalStorage vs SQLite + Local FS (缺失完整的文件持久化)。
3.  **模型**: Veo (Current) vs Sora-2 (Target, `sora-2`) (视频模型需切换)。
4.  **安全**: 前端暴露 Key vs Zero-Secret Frontend (API 调用需移至后端)。
5.  **层级**: Flat Script/Shot vs Episode/Scene/Beat/Shot (数据模型需升级)。

---

## 2. 详细审查 (Detailed Review)

### 2.1 架构与工程结构 (Architecture)
*   **现状**: 标准 Vite 工程，尚未形成 vNext 的 `main/`（Electron Main/Local-Backend）与 `renderer/`（UI）前后端分离目录结构。
*   **问题**: 无法调用本地文件系统，无法跨域代理 (CORS 依赖服务端)，无法持久化大资产。
*   **迁移任务**:
    *   [ ] 初始化 Electron Main Process（建议落到 `main/`：`main/main.ts`, `main/preload.ts`）。
    *   [ ] 配置 `electron-builder` 实现三端打包。
    *   [ ] 建立 IPC 通信通道（优先 `ipcRenderer.invoke`；本地 HTTP/tRPC 仅作为备选）。

### 2.2 数据模型与存储 (Data Model)
*   **现状**:
    *   `types.ts` 定义了 `Shot`, `Character`, `Scene` 等接口。
    *   `App.tsx` 使用 `localStorage` 存储 `GlobalConfig` 和 `ScriptBreakdownResponse`。
    *   缺少 `Episode`, `Season` 等上层容器。
    *   `Shot` 列表是扁平的，缺少 `Scene/Beat` 逻辑层。
*   **风险**: `localStorage` 容量有限 (5MB)，存 Base64 图片极易爆仓；浏览器清除缓存会导致用户数据丢失。
*   **迁移任务**:
    *   [ ] 引入 `better-sqlite3` + `drizzle-orm` (Main Process)。
    *   [ ] 重构数据表结构：`episodes`, `scenes`, `shots`, `assets`。
    *   [ ] 实现文件系统存储：生成结果统一聚合到 Workspace 的 `output/`（例如 `{WorkspaceRoot}/OmniDirector/output/...`），数据库仅存路径/指针。

### 2.3 业务逻辑与 AI 服务 (Business Logic)
*   **代码位置**: `services/geminiService.ts`
*   **审查发现**:
    *   **API Key**: 直接使用 `process.env.API_KEY`，在 Electron 中打包会将 Key 暴露在 `app.asar` 中，违反 **"Frontend Zero Secret"** 红线。
    *   **视频模型**: `generateShotVideo` 使用了 `veo-3.1-fast-generate-preview`，违反 **"仅允许 Sora-2 (`sora-2`)"** 的红线。
    *   **九宫格**: `generateGridImage` 正确实现了 "单次调用生成 3x3 母图" 的策略，符合规范。
    *   **资产切片**: `splitGridImage` (in `utils`) 在前端 Canvas 切割，这部分逻辑可以保留在 Renderer，但保存动作需走 IPC。
*   **迁移任务**:
    *   [ ] 将 `geminiService.ts` 的核心调用逻辑移入 Main/Local-Backend（vNext 目录建议：`main/`）。
    *   [ ] 替换视频模型为 `Sora-2`（模型 ID：`sora-2`；OpenAI 兼容端点：`https://aihubmix.com/v1`）。
    *   [ ] 实现 `TaskQueue` (P-Queue) 控制并发 (Limit 2)。

### 2.4 组件与 UI (Components)
*   **代码位置**: `components/MatrixPromptEditor.tsx`, `App.tsx`
*   **审查发现**:
    *   **UI 逻辑**: `MatrixPromptEditor` 完成度较高，包含母图/子图切换、资产绑定等逻辑，可直接复用。
    *   **状态管理**: `App.tsx` 是 "God Component"，管理了所有状态 (`breakdown`, `config`, `script`)。随着层级增加 (Episode/Scene)，这种模式会难以维护。
    *   **路由**: 目前无路由，单页显示。多 Episode 管理需要引入 `react-router-dom` (HashRouter)。
*   **迁移任务**:
    *   [ ] 引入路由：`Home` (Season/Episode List) -> `Workspace` (Editor)。
    *   [ ] 将状态管理下沉或使用 Zustand/Context，避免 App.tsx 过于臃肿。

### 2.5 安全与合规 (Security)
*   **现状**: 前端直接发起 HTTPS 请求。
*   **问题**:
    *   无法在 Client 端安全存储 API Key。
    *   无法灵活配置代理 (Proxy) 绕过网络限制。
*   **迁移任务**:
    *   [ ] Main Process 接入 `keytar` 或加密存储管理 API Key。
    *   [ ] 实现系统代理读取与配置。

---

## 3. 严重问题清单 (Critical Issues)

| ID | 优先级 | 问题描述 | 违反规则 | 修复建议 |
| :--- | :--- | :--- | :--- | :--- |
| **C01** | **P0** | 使用 Veo 模型生成视频 | **Rules 4.4.2** (仅 Sora-2 / `sora-2`) | 切换模型 ID 为 aihubmix 的 `sora-2`。 |
| **C02** | **P0** | 前端持有 API Key | **Rules 4.1** (Zero Secret) | 移除前端 `process.env`，改为 IPC 调用主进程方法。 |
| **C03** | **P0** | 数据存储在 LocalStorage | **Rules 4.6** (禁止 Base64 持久化) | 立即引入 SQLite + FS，图片落地为文件。 |
| **C04** | **P1** | 缺少 Episode/Scene 层级 | **Rules 3.2** (Episode结构) | 数据库设计需包含 `Episode -> Scene -> Shot` 关系。 |
| **C05** | **P1** | 无任务队列与重试 | **Rules 4.4** (Task Queue) | 主进程引入 `p-queue`，实现并发控制与持久化。 |

---

## 4. 迁移行动计划 (Action Plan)

建议按以下顺序执行代码重构：

### Phase 1: 骨架搭建 (Skeleton)
1.  安装 Electron 依赖 (`electron`, `electron-builder`, `concurrently`).
2.  配置 `vite.config.ts` 以支持 Electron 构建。
3.  创建 `main/main.ts` 和 `main/preload.ts`，打通 IPC `ping-pong`。

### Phase 2: 数据层落地 (Data Layer)
1.  在 Main Process 初始化 SQLite (`better-sqlite3`).
2.  定义 Drizzle Schema (`episodes`, `shots`).
3.  实现 IPC 接口：`createEpisode`, `loadEpisode`, `saveShot`.

### Phase 3: 业务迁移 (Logic Migration)
1.  将 `geminiService` 搬运至 Main Process。
2.  修改前端组件，将 `await generateGridImage(...)` 改为 `await window.api.generateGrid(...)`。
3.  修正视频生成模型为 Sora-2（`sora-2`）。

### Phase 4: 清理与交付 (Cleanup)
1.  移除 `localStorage` 相关代码。
2.  配置打包脚本，生成 DMG/EXE 进行验证。

---

**结论**: 当前代码是优秀的**功能原型**，但距离**交付产品**还需进行一次完整的架构 "Wrapper" 升级。无需重写 UI 组件，重点在于后端能力的本地化注入。
