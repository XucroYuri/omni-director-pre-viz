---
status: ARCHIVED
---

# 图像生成模块代码审计报告 (Image Generation Audit Report)

> 历史文档说明：本报告为分支阶段审计快照，当前实施入口为 `rules.md` 与 `docs/*`。

**日期**: 2025-12-25
**审计对象**: 图像生成全链路 (Frontend -> TaskQueue -> Provider -> FileSystem -> Rendering)
**结论**: 核心生成逻辑已实现，但存在 **渲染层安全策略阻断** 与 **配置管理缺失** 两大阻断性问题，导致应用无法正常交付图片。

---

## 1. 现状流程梳理

经过代码审查，当前项目的图像生成链路如下：

1.  **触发**: 前端 `MatrixPromptEditor` 点击“渲染矩阵母图”，调用 `App.tsx` 中的 `handleGenerateImage`。
2.  **提交**: `App.tsx` 构建 `MATRIX_GEN` 任务，通过 IPC `app.task.submit` 提交至主进程。
3.  **调度**: 主进程 `TaskQueue` 接收任务并持久化至 SQLite，唤醒 `TaskRunner`。
4.  **执行**:
    *   `TaskRunner` 识别 `MATRIX_GEN` 类型。
    *   调用 `aihubmix/gemini.ts` 的 `generateGridImage` 进行 AI 生成。
    *   **API Key 获取**: 仅通过 `process.env.AIHUBMIX_API_KEY` 获取 (依赖 `.env` 文件)。
    *   **文件落盘**: 生成结果写入 `output/images/grid_*.png`。
    *   **重要路径说明**: 默认写入路径为 `app.getPath('userData')/output` (例如 macOS 下为 `~/Library/Application Support/OmniDirector/output`)，而非项目源码根目录。因此用户在根目录看不到 output 是预期的，但文件确实存在。
5.  **后处理**:
    *   `TaskRunner` 调用 `sharp` 将母图切割为 9 张子图。
    *   子图路径被写入 SQLite (`shots` 表的 `split_images_json` 字段)。
    *   路径格式为 **绝对路径** (e.g., `/Users/username/Library/Application Support/.../output/images/...`)。
6.  **反馈**:
    *   任务状态更新广播至前端。
    *   前端 `App.tsx` 监听到 `completed` 状态，触发 `reloadEpisode` 从 DB 重载数据。
7.  **渲染 (失败点)**:
    *   `MatrixPromptEditor` 读取 `shot.splitImages` (绝对路径)。
    *   尝试渲染 `<img src="/Users/..." />`。

---

## 2. 阻断性问题 (Blockers)

### 2.1 渲染层安全策略阻断 (Critical)
*   **现象**: 母图和切片已成功生成并写入磁盘（位于系统 `userData` 目录），但前端界面显示空白或破图。
*   **原因**: Electron (基于 Chromium) 的安全策略默认禁止在 Renderer 进程中直接加载本地文件 (`file://` 协议或绝对路径)，除非：
    1.  禁用 `webSecurity` (不推荐)。
    2.  注册自定义协议 (e.g., `omnidir://`) 并拦截请求指向本地文件。
*   **证据**: `src/main/main.ts` 中未注册任何 `protocol` 处理器，且 `webPreferences` 未禁用安全策略。
*   **影响**: **所有生成结果均无法在界面展示**。

### 2.2 API Key 配置缺失 (High)
*   **现象**: 生成任务直接失败，日志报错 "Missing AIHUBMIX_API_KEY"。
*   **原因**: 后端仅从环境变量 (`process.env`) 读取 Key。打包后的应用或普通用户启动时，通常没有配置 `.env` 文件的入口。
*   **证据**: `src/main/providers/aihubmix/env.ts` 明确抛出错误 `throw new Error('Missing AIHUBMIX_API_KEY...')`。
*   **影响**: 普通用户无法使用生成功能。

### 2.3 原生依赖风险 (Medium)
*   **现象**: `TaskRunner` 执行到“切片”步骤时失败。
*   **原因**: 使用了 `sharp` 库。这是一个 Native Module，如果在不同平台(Win/Mac/Linux)或架构(x64/arm64)间迁移，或者构建配置不当，极易导致运行时加载失败。
*   **建议**: 需确保 CI/CD 流程包含 `electron-builder` 的 `npmRebuild` 步骤，并验证多平台构建。

---

## 3. 修复与重构建议

### 3.1 解决图片加载问题 (P0)
**方案**: 引入自定义协议 `omnidir://` 访问本地资源。

1.  **Main Process (`main.ts`)**:
    ```typescript
    import { protocol } from 'electron';
    
    app.whenReady().then(() => {
      protocol.registerFileProtocol('omnidir', (request, callback) => {
        const url = request.url.replace('omnidir://', '');
        // 安全校验：确保 url 在 outputDir 或 userData 目录下
        const decodedUrl = decodeURI(url);
        try {
          return callback(decodedUrl);
        } catch (error) {
          console.error('Failed to register protocol', error);
        }
      });
      // ... existing code
    });
    ```
2.  **Renderer Process**:
    将所有绝对路径转换为 `omnidir://${absolutePath}` 格式后再传递给 `<img>` 标签。或者在 Main 进程返回路径时就做好转换。

### 3.2 完善 Key 配置体验 (P1)
**方案**: 实现 UI 配置面板 + 安全存储。

1.  **Frontend**: 在设置面板增加 "API Key" 输入框。
2.  **Backend**: 使用 `electron-store` (并加密) 存储 Key，不再强依赖 `process.env`。
3.  **Fallback**: `getAihubmixEnv` 优先读取 `process.env` (开发用)，其次读取 Store (生产用)。

### 3.3 规范化输出目录 (P2)
**方案**: 遵循 `Plan-Codex` 规范。

1.  **当前行为**: 默认写到 `app.getPath('userData')/output`。
2.  **目标行为**: 允许用户在设置中自定义 `Workspace` 路径（默认为 `~/Documents/OmniDirector`），让 `output` 对用户可见。
3.  **路径结构**: `output/{Project}/{Season}/{Episode}/shots/{ShotId}/grid_{GridId}/...`
4.  **目的**: 方便用户直接在文件系统中浏览和管理，以及后续的 ZIP 打包。

---

## 4. 结论
当前应用**无法生成图片**的主要技术障碍是 **Electron 安全策略阻止了本地图片加载**，以及 **API Key 缺乏配置入口**。解决这两个问题后，基本的生成链路即可跑通。
