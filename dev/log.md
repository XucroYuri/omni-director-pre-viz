
# 开发者日志 (Developer Log)

记录约定（建议）：
- 日常追加可继续写在本文件；当单次迭代内容较多时，建议新建 `dev/log_YYYYMMDD_topic.md`，并按 `rules.md` 的“dev 文档模板”记录。
- 交付给 PM 的摘要可直接用 `dev/reference_vibe-coding-skill/templates/Change-Report.md`。

## 2024-05-20: 初始化架构
- **任务**: 搭建基础 SPA 结构。
- **决策**: 采用侧边栏布局，左侧为剧本与镜头列表，右侧为资产配置，中心为矩阵编辑器。
- **注意**: Gemini 3 Pro Image 在生成 4K 图片时耗时较长，需在 UI 上提供明确的排队状态反馈。

## 2024-05-20: 核心服务封装
- **任务**: 封装 `geminiService.ts`。
- **逻辑**: 实现 `breakdownScript` (Text-to-JSON) 和 `generateGridImage` (Text-to-Image)。
- **切图逻辑**: 引入 Canvas 离屏渲染进行 3x3 网格切分。

## 2025-12-21: 重构共识锁定 (Phase 1 启动前)
- **事件**: 完成 C队 (Main) 与 G队 (Aux) 的方案对齐。
- **成果**: 
  - 锁定 `dev/Consensus-Lock.md`。
  - 确认架构迁移至 **Electron Local-First**。
  - 确认数据层级 **Season -> Episode -> Beat -> Shot**。
  - 确认 **aihubmix-only** 与 **Zero-Secret** 安全红线。
- **状态**: G队已同意启动 Phase 1 (Skeleton)。

## 2025-12-22: Phase 1 & 2 完成 (Electron 骨架与 Provider 接入)
- **事件**: 完成 Phase 1 (Electron 骨架) 与 Phase 2 (Main IPC Provider)。
- **成果**:
  - Phase 1: 建立 `src/main`, `src/preload`, `src/renderer` 隔离架构；移除前端 Provider SDK。
  - Phase 2: 实现 Main 进程 `aihubmix` 接入 (Gemini/Sora-2)；实现并发限流；实现 IPC 安全通道。
  - **合规**: 通过 G 队代码审计 (S级)；通过 Docs-as-Gates 锁定检查（触碰锁定区需 Maintainer 标签）。
- **门禁事件**: `Locked Files Guard` 因触碰锁定区（`src/main/providers/**`）拦截；Maintainer 已添加标签 `maintainer-approved`，Actions 重跑并放行。
- **状态**: PR `feat/phase2-aihubmix-provider-ipc` 已合并至 `main`。

## 2025-12-22: Phase 3 完成 (前端联调 & Smoke Test)
- **事件**: 完成 Phase 3 (Frontend Integration) 并合并至 `main`。
- **成果**:
  - **全链路打通**: UI (`MatrixPromptEditor`) -> IPC -> Main Provider (`aihubmix`) -> Output (`videos/`) -> UI Preview。
  - **遗留清理**: 彻底移除 Renderer 中残留的 `window.aistudio` (旧 Veo SDK) 逻辑。
  - **CI 状态**: PR `feat/phase3-frontend-integration` 通过所有门禁（本次未触碰锁定文件，无需额外标签）。
- **当前状态**: 代码已合并。建议立即进行全链路 Smoke Test (Text -> Image -> Video)。
- **后续计划**: 根据 Smoke Test 结果，准备 Phase 4 (打包与发布) 或进入功能迭代 (Phase 1.1)。

## 2025-12-22: 本地开发环境问题 - Electron 安装与环境变量
- **事件**: `npm run dev` 启动时 Electron 报错 “failed to install correctly”，以及 `app.whenReady` 为 `undefined`。
- **原因**:
  - Electron 二进制未下载（`node_modules/electron/dist` 缺失）。
  - 本机环境变量 `ELECTRON_RUN_AS_NODE=1` 导致 Electron 以 Node 模式运行（无 `app`）。
- **处置**:
  - 使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js` 触发下载。
  - 在 `package.json` 的 `dev:electron` 中强制设置 `ELECTRON_RUN_AS_NODE=0` / `ELECTRON_FORCE_IS_PACKAGED=0` 防止再次误触。
