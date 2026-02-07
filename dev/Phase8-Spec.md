---
status: SUPERSEDED
---

# Phase 8 Final Spec: Solid Foundation (C-Team)

> 历史文档说明：本文件为历史阶段最终稿，当前实施入口为 `rules.md` 与 `docs/*`。

**状态**: Final Draft  
**作者**: C-Team (Planner)  
**日期**: 2025-12-23  
**范围**: Phase 8（性能、跨平台、打包分发、易用启动）

---

## 0. 审阅结论与决策

1. **接受 G 队分阶段策略**（Phase 8 + Phase 9）。  
   **理由**: 数据库层级重构是高风险 Breaking Change，与跨平台/打包同时推进会显著放大排障成本；先稳定平台与分发，再做架构迁移更可控。
2. **Virtualization 选择固定卡片高度方案**。  
   **理由**: 低风险、可快速落地，避免动态高度虚拟化的复杂测量和跳动问题；需要详细信息时通过 Drawer/Detail View 展示。
3. **Packaging 三端并行，但 Auto-updater 分级**。  
   **策略**: Windows + macOS 完整接入 auto-update；Linux 提供 AppImage 手动更新（Phase 9 再补全）。

---

## 1. 目标与非目标

### 1.1 目标
- 大量 Shot 列表不卡顿（500+ 以上可滚动流畅）。
- Windows / macOS / Linux 可构建、可运行。
- 一键初始化与启动脚本可用。
- 有可发布的安装包与基础更新机制。

### 1.2 非目标
- 不进行 Project / Season / Episode 的数据库结构重构。
- 不引入 Season 级资产共享逻辑与 UI。
- 不做复杂的跨 Episode 资产迁移。

---

## 2. 交付内容（Deliverables）

### 2.1 跨平台基础修复
- 全项目路径处理统一使用 `path.join/resolve`，避免硬编码分隔符。
- 统一文件路径与 `file://` URL 的转换工具。
- 修复 Windows/Linux 下 `sharp` 与 `better-sqlite3` 构建与运行问题。

### 2.2 性能优化
- Shot List 虚拟滚动（固定高度）。
- 图片懒加载与缩略图缓存。

### 2.3 打包与分发
- GitHub Actions Matrix 构建多端安装包（`.dmg` / `.exe` / `.AppImage`）。
- `electron-updater` 基础接入（Windows/macOS）。
- Linux 保留手动下载更新流程。

### 2.4 一键脚本
- `init.sh`, `init.ps1`：环境依赖安装 + 依赖编译/重建。
- `start.sh`, `start.bat`：一键启动开发环境。

---

## 3. 技术方案

### 3.1 路径与文件处理规范
- 新增共享工具 `src/shared/pathUtils.ts`：  
  - `toFileUrl(path)` / `fromFileUrl(url)`  
  - `normalizePath(path)`（处理分隔符、去重）
- 所有文件读写必须在 Main 进程完成；Renderer 只传相对路径或 file URL。

### 3.2 原生依赖重建
- `electron-builder` 增加 `npmRebuild: true` 与平台构建参数。
- CI 中明确 Node/Electron 版本锁定，避免 ABI 不一致。

### 3.3 Shot List Virtualization
- **核心组件**: `react-window` (FixedSizeList) + `react-virtualized-auto-sizer`。
- **UI 约束**:
  - 统一卡片高度：设定为 **72px** (Compact Mode) 或 **220px** (Card Mode)。Phase 8 优先实现 Compact Mode (72px)。
  - 文本截断：使用 `line-clamp` 处理变长文本。
  - 详情展示：点击列表项通过侧边 Drawer 展示完整信息，避免列表内展开导致的动态高度计算。
- **实现细节 (G-Team Proposal)**:
  - 使用 `AutoSizer` 自动获取父容器宽高。
  - `FixedSizeList` 接收 `height`, `width`, `itemSize={72}`。
  - `itemData` 传递上下文对象 `{ shots, config, activeShotId, onSelect, onDelete }`，避免闭包过时问题。
  - Row 组件使用 `memo` 优化渲染，仅在数据变化时重绘。


### 3.4 图片加载与缓存
- Renderer 使用 `loading="lazy"`。
- Main 侧提供 `getThumbnail(path, width)`：  
  - 使用 `sharp` 生成缩略图  
  - 缓存目录：`app.getPath('userData')/thumbs`

### 3.5 Packaging / Auto-updater
- 使用 `electron-builder` 的 GitHub Provider 发布。
- Windows/macOS: 启动后检查更新并提示。
- Linux: 仅提供下载链接/版本提示（无自动更新）。
- 代码签名作为可选项，若无证书则以内部测试版发布。

### 3.6 Init/Start 脚本
- `init.sh` / `init.ps1`：安装依赖并尝试 `npm rebuild`。
- `start.sh` / `start.bat`：运行 `npm run dev`。
- 提供 README 指引和故障提示（如缺少构建工具）。

### 3.7 Phase 9 预埋
- 在 Episode `config_json` 中预留 `projectName` / `seasonName` 字段（无 schema 变更）。
- Repo 层抽象接口保留扩展点（避免未来改动 UI 时再大改 IPC）。

---

## 4. 验收标准

- 500+ Shot 滚动无明显卡顿（60fps 目标，肉眼流畅）。
- Windows / macOS / Linux 能成功构建并启动。
- `npm run build` 在 CI Matrix 全通过。
- Auto-updater 在 Win/Mac 能拉取版本提示并更新。
- init/start 脚本在至少两种 OS 上验证成功。

---

## 5. 风险与缓解

- **原生依赖构建失败**: 加强 CI 依赖缓存与 ABI 锁定，提供 `npm rebuild` 兜底脚本。
- **虚拟滚动引发布局变化**: 固定卡片高度并提供详情查看替代。
- **Auto-updater 证书缺失**: 允许内部版本不签名发布，正式发布再引入证书。

---

## 6. Phase 9 接续项（仅记录）

- 数据库层级升级（Project / Season / Episode）。
- Season 级资产共享与引用逻辑。
- Linux auto-update 与完整签名策略。

---

## 7. C/G 协作与双重确认流程

- **C 队**提供最终 Spec（本文件）与实施拆解。
- **G 队**提交技术复核与风险清单（交叉验证方案可行性）。
- **比稿与交流**：对分歧点给出替代方案与取舍理由，形成可追踪结论。
- **双重确认门禁**：C/G 双方确认后方可进入 Phase 8 实际开发。
