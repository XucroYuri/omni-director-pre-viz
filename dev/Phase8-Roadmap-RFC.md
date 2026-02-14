---
status: REFERENCE
---

# Omni Director Pre-Viz: Future Roadmap (Phase 8+) RFC

> 历史文档说明：本文件为历史路线 RFC，当前实施入口为 `rules.md` 与 `docs/*`。

**Status:** Accepted / Closed
**Author:** XucroYuri (Req), G-Team (Tech Analysis)
**Target Audience:** C-Team (Planner)
**Outcome:** See [Phase8-Spec.md](./Phase8-Spec.md)

## 0. Conclusion (2025-12-23)
C-Team has reviewed this RFC and accepted the proposal to split the roadmap into Phase 8 (Foundation) and Phase 9 (Enterprise).
Key decisions:
- **Phasing**: Accepted. Phase 8 focuses on stability/distribution; Phase 9 on schema refactoring.
- **Virtualization**: Fixed height strategy chosen.
- **Packaging**: 3-platform support with tiered auto-update (Win/Mac auto, Linux manual).

See `dev/Phase8-Spec.md` for the executable plan.

---

## 1. 原始需求 (User Requirements)

XucroYuri 提出了以下五大维度的演进方向：

1.  **Performance**: 大列表虚拟滚动 (Virtualization)，解决长 Shot 列表卡顿问题。
2.  **Multi-Episode**:
    *   层级升级：IP -> Project -> Season -> Episode。
    *   资产共享：Season 级别的资产库（Character/Location）供不同 Episode 复用。
3.  **Packaging**: 正式打包发布流程 (CI/CD, Auto-updater)，易用、易于部署。
4.  **Multi-System Support**: 支持 Windows, MacOS, Linux。
5.  **Easy Init/Start**: 快速一键部署、初始化脚本和一键启动脚本。

---

## 2. G-Team 技术分析 (Technical Feasibility & Risks)

作为当前代码库的实现者，G 队提出以下技术约束和风险评估，供 C 队规划时参考。

### A. 数据库架构重构风险 (High Risk)
*   **现状**: `episodes` 表是扁平的，`assets` 直接关联 `episode_id`。
*   **挑战**: 实现 `Season` 级别资产共享意味着 `assets` 表需要解耦。我们需要引入 `project_id` 或 `season_id` 外键，并处理“全局资产”与“剧集特有资产”的覆盖逻辑。
*   **G队建议**: 这是一个**Breaking Change**。涉及大量的数据迁移（Migration）。如果在做跨平台适配的同时做这个，容易导致难以追踪的 Bug。

### B. 跨平台兼容性 (High Effort)
*   **Native Modules**: 我们使用了 `better-sqlite3` 和 `sharp`。这两个库都依赖原生编译。
    *   **Windows**: 需要处理 MSVC 环境，路径分隔符 (`\` vs `/`) 问题。
    *   **Linux**: 需要处理依赖库（glibc 版本等）。
*   **G队建议**: 需要在 CI 环境中配置 Matrix Build，确保每个平台的二进制文件正确构建。代码中所有的路径处理必须统一使用 `path.join`。

### C. 性能优化 (Medium Effort)
*   **Virtualization**: 引入 `react-virtuoso` 或 `react-window`。
*   **难点**: 我们的 Shot Card 高度是不固定的（取决于 Grid 图片的宽高比和文本长度）。需要实现动态高度的虚拟列表，或者统一卡片高度。

### D. 打包与分发 (DevOps)
*   **Auto-updater**: 需要配置 `electron-updater` 并签名（Code Signing）。
    *   MacOS 签名需要 Apple Developer ID ($$$)。
    *   Windows 签名需要 EV/OV 证书 ($$$)。
*   **CI/CD**: Github Actions 配合 Release Draft。

---

## 3. G-Team 的提案 (Proposal for Debate)

为了保证稳定性，G 队建议**拒绝**一次性实施所有功能。建议拆分为 Phase 8 和 Phase 9。

### Phase 8: The "Solid Foundation" Release
**目标**: 让当前功能在全平台流畅运行，易于分发。不修改核心数据结构。

1.  **Cross-Platform Core**:
    *   统一路径处理 (`src/shared/utils.ts`)。
    *   解决 Windows/Linux 下 `sharp`/`sqlite3` 的构建问题。
    *   编写 `init.sh`, `init.ps1`, `start.bat` 等一键脚本。
2.  **Performance Boost**:
    *   前端重构：引入虚拟滚动列表。
    *   图片加载优化（Lazy load + Thumbnail caching）。
3.  **DevOps Pipeline**:
    *   配置 GitHub Actions 自动构建多端安装包 (`.dmg`, `.exe`, `.AppImage`)。
    *   实现 Auto-updater 基础流程。

### Phase 8.x: UI/UX Refinement (Planned)
**目标**: 优化布局与交互体验，解决 Sidebar 拥挤问题。

1.  **Split Layout**:
    *   拆分 Sidebar 为双栏或三栏布局：`[Script Panel] [Sequence Panel] [Main Content]`。
    *   支持面板折叠与拖拽调整宽度。
2.  **i18n & Theming**:
    *   完善国际化支持（zh-CN/en-US）。
    *   完善 Light/Dark 主题切换。

### Phase 9: The "Enterprise" Release
**目标**: 在平台稳定的基础上，升级业务逻辑，支持复杂的剧集管理。

1.  **Schema Refactor**:
    *   引入 `Project`, `Season` 表。
    *   迁移旧数据（将孤立 Episode 归档到默认 Project）。
2.  **Asset Manager Upgrade**:
    *   实现 Season 级资产库 UI。
    *   实现资产的“引用”与“复用”逻辑。

---

## Action for C-Team (Historical Context)

> **Note:** This section reflects the initial request during the RFC drafting. The breakdown has been completed and incorporated into the Phase 8 Spec.

Please review the above technical analysis and:
1.  **Breakdown Phase 8**: Split the massive "Phase 8" into smaller, manageable sub-phases (e.g., Phase 8.1, 8.2) based on the dependencies identified above.
2.  **Define Priorities**: Decide which features (Virtualization vs Multi-Episode vs Packaging) come first.
3.  **Update Spec**: Incorporate the technical constraints (path handling, Electron limitations) into the formal spec.
