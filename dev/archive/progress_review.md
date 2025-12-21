# 项目进度审查与重构建议 (Progress Review & Refactoring Plan)

**日期**: 2025-12-20
**状态**: 初始评估完成

---

## 1. 现状快扫 (Overview)

经过对 `src/` 目录代码的全面审查，并对比 `Plan-FullStack-BFF.md` 与 `rules.md`，当前项目处于 **单机原型 (SPA)** 阶段，与目标架构（**Full-Stack BFF**）存在显著的代差。

| 维度 | 当前实现 (Current) | 目标架构 (Target) | 差距评估 |
| :--- | :--- | :--- | :--- |
| **API 调用** | 前端直连 Google SDK (`geminiService.ts`) | BFF 代理 (tRPC/Node.js) | **CRITICAL** (严重安全隐患) |
| **数据流** | Script -> Shot (无 Scene/Beat) | Script -> Scene/Beat -> Shot | **MAJOR** (业务逻辑缺失) |
| **生成策略** | 9次调用/单次调用混杂 | 强制单母图 + 物理切割 | **MAJOR** (成本与一致性) |
| **存储** | 内存/LocalStorage (Base64) | IndexedDB (Blob) + OSS | **CRITICAL** (性能瓶颈) |
| **UI 组件** | Sidebar/MatrixEditor 高耦合 | 原子化组件 + Zustand Store | **MODERATE** (维护性差) |

---

## 2. 详细实现评估

### 2.1 有效实现 (Positives)
*   **Prompt 矩阵编辑 (`MatrixPromptEditor.tsx`)**:
    *   3x3 网格布局与交互逻辑基本成型，支持单格编辑和预览。
    *   `handleBatchDownload` 实现了基础的批量下载功能。
*   **资产关联 UI (`Sidebar.tsx`)**:
    *   `AssetCard` 组件虽然内嵌定义（需重构），但交互逻辑（上传参考图、AI 生成参考图）已打通。
    *   资产库的增删改查（CRUD）逻辑在前端已跑通。
*   **Prompt 优化 (`geminiService.ts`)**:
    *   `optimizePrompts` 和 `discoverMissingAssets` 的 Prompt 工程逻辑较为成熟，可直接迁移至 BFF。

### 2.2 错误/偏差实现 (Negatives & Deviations)

#### A. 架构级错误 (Architectural Flaws)
1.  **前端密钥暴露 (`geminiService.ts:15`)**:
    *   `apiKey: process.env.API_KEY` 直接在前端读取环境变量，这在生产环境中是绝对禁止的。
2.  **上帝组件 (`App.tsx` & `Sidebar.tsx`)**:
    *   `Sidebar` 组件内部通过 `props` 透传了所有状态 (`config`, `shots`, `script`...)，导致严重的 Props Drilling。
    *   `AssetCard` 在 `Sidebar` 内部定义，导致每次渲染都会销毁重建 DOM，性能极差。

#### B. 业务逻辑缺失 (Business Logic Gaps)
1.  **剧本拆解粒度不足 (`geminiService.ts:52`)**:
    *   目前仅实现了 `Script -> Shot` 的扁平拆解，完全缺失 `Scene` (场景) 和 `Beat` (节拍) 的中间层级。这会导致长剧本解析混乱。
2.  **生成策略不统一 (`geminiService.ts:186`)**:
    *   虽然 `generateGridImage` 实现了拼合 Prompt，但 `generateMatrixPrompts` 仍然返回 9 个独立 Prompt，且前端逻辑中存在混用单图生成和矩阵生成的痕迹。
3.  **Base64 滥用 (`geminiService.ts:229`)**:
    *   生成的图片直接以 Data URL (Base64) 形式返回并存储在 State 中。对于 4K 图片，这会迅速耗尽浏览器内存并导致卡顿。

---

## 3. 重构思路 (Refactoring Strategy)

### Phase 1: 架构分层与 BFF 引入 (Infra)
1.  **建立 Monorepo**: 将项目拆分为 `apps/web` (前端) 和 `apps/server` (BFF)。
2.  **移除 Google SDK**: 前端卸载 `@google/genai`，替换为 `@trpc/client`。
3.  **状态管理迁移**: 引入 `Zustand`，创建 `useProjectStore` (元数据) 和 `useTaskStore` (生成任务)。

### Phase 2: 核心业务逻辑修正 (Logic)
1.  **剧本引擎升级**:
    *   在 BFF 端重写 `ScriptBreakdownService`，实现 `Script -> Beat -> Shot` 的三层解析。
    *   前端 `Sidebar` 适配树状结构展示 (Scene -> Beat -> Shot)。
2.  **生成管线重构**:
    *   **后端**: 实现 `MatrixJob` Queue，负责调用 LLM 生成 3x3 母图，并上传 OSS。
    *   **前端**: 仅接收 `imageUrl` (OSS 链接)，使用 Canvas API 在本地进行 3x3 切割展示。

### Phase 3: 存储与性能优化 (Performance)
1.  **IndexedDB 落地**:
    *   引入 `idb`，接管所有图片/视频 Blob 的存储。
    *   前端仅保留 `blob://` URL，内存占用降低 90%。
2.  **组件拆分**:
    *   将 `AssetCard` 提取为独立文件。
    *   将 `Sidebar` 的长列表改为虚拟滚动 (`react-window`)。

---

## 4. 需求方决策记录 (Stakeholder Decisions)

### 4.1 多项目管理与入口 (Multi-Project & Entry Point)
*   **决策**: 预留“多项目管理”面板，但**优先打通单项目流程**。
*   **实施策略**:
    *   **Season 层为核心入口**: 将 `Season` 界面作为应用的初始化入口，负责统筹共用资产（角色/场景）并展示下属的 `Episode` 列表。
    *   **IP/Project 层**: 仅作为元数据标签（Tags/Metadata）存在，用于未来分类，暂不开发独立管理组件。
    *   **Episode 层**: 承载具体作业流（剧本 -> 镜头 -> 矩阵）。

### 4.2 视频生成模型 (Video Generation Model)
*   **决策**: **弃用 Veo 模型**，改用 `aihubmix` 提供的 **Sora 2** 模型作为首选。
*   **实施策略**:
    *   **BFF 适配**: 在 BFF 层集成 `aihubmix` 的视频生成 API，配置 `Sora 2` 为默认模型。
    *   **扩展性**: 架构设计需支持未来接入其他视频模型（Plugin 模式），不做额度限制，但需在 BFF 层做基础的并发/排队控制。

### 4.3 离线模式与网络稳定性 (Offline & Network)
*   **决策**: **弱化离线功能**，不追求完全离线可用。
*   **实施策略**:
    *   **重心**: 聚焦于处理**网络抖动**和**断连恢复**。
    *   **机制**:
        *   **请求重试**: 关键 API 调用失败后自动指数退避重试。
        *   **本地缓存**: 使用 IndexedDB 缓存已下载的资产和状态，确保断网时不白屏，可浏览已加载内容。
        *   **任务恢复**: 网络恢复后，自动同步挂起的任务状态。

---
**Next Action**: 建议优先启动 **Phase 1 (BFF 引入)**，彻底解决安全隐患，再进行业务逻辑的修补。
