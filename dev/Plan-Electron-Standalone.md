# Plan-Electron-Standalone: 跨平台本地化一键运行方案

**版本**: V1.0 (Local-First Architecture)
**日期**: 2025-12-20
**状态**: Reference（非权威实施标准）
**目标**: 实现 Mac/Windows/Linux 三端一键运行，绿色免安装，适合开源分发。

> 权威实施标准与验收口径以 `dev/Plan-Codex.md` + `rules.md` + `dev/Guardrails.md` 为准；本文仅作为“Electron 桌面化/打包落地”的参考材料。

---

## 1. 核心架构演进：从 Web SaaS 转向 Electron Desktop

为了满足“一键运行、绿色整合、开源友好”的需求，我们将架构从“前后端分离的 Web 服务”调整为 **“Electron 桌面应用”**。

### 1.1 架构图 (Architecture Overview)

```mermaid
graph TD
    User[用户 (Desktop)] --> UI[Electron Renderer (React + Vite)];
    UI -- IPC invoke (default) --> Main[Electron Main Process (Node.js)];
    
    subgraph LocalHost [本地环境 (自带依赖)]
      Main -- Logic --> Queue[Task Queue (P-Queue/In-Memory)];
      Main -- ORM --> SQLite[SQLite (season.db + episode.db)];
      Main -- FS --> LocalFS[本地文件系统 (Workspace data/output)];
      Queue -- HTTPS --> ExternalAPI[aihubmix only (gemini + openai)];
    end

    subgraph Security [安全层]
      KeyStore[OS Keychain / Encrypted Config] -.-> Main;
    end
```

### 1.2 核心价值

1.  **开箱即用 (Out-of-the-Box)**:
    *   **自带环境**: 通过 Electron 打包 Chromium 和 Node.js，用户无需安装浏览器或 Node 环境。
    *   **零配置数据库**: 使用 **SQLite** 替代 PostgreSQL，文件级数据库，随应用启动即用。
    *   **绿色版**: 支持 Portable 模式（数据存放在应用同级目录或 AppData），解压即用，删除即卸载。

2.  **本地优先 (Local-First)**:
    *   **数据主权**: 所有剧本、图片、视频直接保存在用户本地硬盘，无云端泄露风险。
    *   **性能卓越**: 直接读写本地文件系统，无网络传输延迟（API 调用除外）。

3.  **极简架构 (Minimalism)**:
    *   **去中心化**: 移除 Redis、BFF 服务器、OSS 存储桶。所有逻辑内聚在 Electron 主进程。
    *   **开源友好**: 开发者 `git clone` -> `npm install` -> `npm run dev` 即可运行，无复杂的 Docker/DB 环境依赖。

---

## 2. 技术栈调整 (Tech Stack Shift)

| 模块 | 原计划 (Cloud BFF) | **新计划 (Electron Standalone)** | 优势 |
| :--- | :--- | :--- | :--- |
| **Runtime** | Browser + Node Server | **Electron** (Main + Renderer) | 跨平台，能力强 (FS/Shell) |
| **API 通信** | HTTP / WebSocket | **IPC (Inter-Process Communication)** | 零网络开销，类型安全 |
| **数据库** | PostgreSQL / Mongo | **SQLite**（建议 Drizzle；driver 选型需支持 Electron prebuild） | 单文件，无需后台进程 |
| **队列** | Redis + BullMQ | **P-Queue** (In-Memory + SQLite持久化) | 轻量，无 Redis 依赖 |
| **存储** | AWS S3 / OSS | **Local File System** (Node `fs`) | 免费，速度快，无限制 |
| **打包** | Docker Image | **Electron-Builder** (NSIS/DMG/AppImage) | 原生安装体验 |

---

## 3. 模块详细设计

### 3.1 目录结构规范
应用运行时在本地生成标准目录结构（类似 Adobe 软件工程目录）：

```text
{WorkspaceRoot}/OmniDirector/
├── data/                  (Season/Episode 元数据与资产索引)
│   ├── season.db
│   └── episodes/{EpisodeID}/episode.db
└── output/                (用户交付入口：图片/视频/manifest/ZIP)
    └── {ProjectName}/season_{SeasonNo}/episodes/{EpisodeID}/...
```

### 3.2 核心模块迁移

#### A. 剧本引擎 & 资产管理
*   **迁移**: 逻辑从 BFF Service 移至 **Electron Main Process**。
*   **存储**: 
    *   元数据 (Shot info, Prompts) -> **SQLite**。
    *   图片 Blob -> **本地文件** (e.g., `assets/char_01.png`)。

#### B. 任务队列 (Task Queue)
*   **实现**: 使用 `p-queue` 管理并发；并发上限按能力分池：`LLM=10` / `IMG=5` / `VID=3`；并支持 Provider 侧临时限流/并发超限时“自动降级并发 + 冷却期恢复”（详见 `dev/Plan-Codex.md`）。
*   **持久化**: 任务状态写入 SQLite。应用重启时，从 SQLite 读取 `PENDING` 任务并恢复队列，实现“断点续传”。

#### C. API 适配与安全
*   **API Key 存储**:
    *   **交付产物不含 Key**：首次运行/缺失/不可用必须弹窗提示用户输入；Key 仅存 Main（对齐 `rules.md:4.1.3`）。
    *   **开发模式**: `.env` 仅供 Main 进程读取（禁止注入前端 bundle）。
    *   **生产模式**: 加密落盘（例如 `electron-store`）+ OS Keychain/凭据库作为根（设备绑定自动失效销毁）。
*   **网络代理**: Main 读取系统代理（如需要），但 Provider Source 仍必须 aihubmix-only（禁止直连任何官方 API）。

---

## 4. 开发与发布流程 (DevOps)

### 4.1 开发环境
*   **命令**: `npm run dev` (同时启动 Vite Server 和 Electron Watcher)。
*   **调试**: VSCode 支持同时调试 Main 和 Renderer 进程。

### 4.2 构建与发布
使用 `electron-builder` 配置：
*   **Windows**: NSIS Installer (一键安装) + Portable (免安装 exe)。
*   **Mac**: DMG + Zip（建议 Hardened Runtime + Notarization；签名密钥永不入库，见 `rules.md:6.1`）。
*   **Linux**: AppImage (通用) + Deb/Snap。

### 4.3 GitHub Actions
*   配置自动构建流程：Push Tag -> Build -> Release Draft -> Upload Artifacts。
*   用户直接在 GitHub Releases 页面下载对应系统的安装包。

---

## 5. 迁移路线图 (Migration Roadmap)

### Phase 1: Electron 壳与基础建设 (2 Days)
*   初始化 Electron + Vite + React 模板。
*   配置 `electron-builder`。
*   实现 IPC 通信基础封装 (tRPC over IPC 或简单的 `ipcRenderer.invoke`)。

### Phase 2: 数据层本地化 (3 Days)
*   引入 `drizzle-orm` + `better-sqlite3`。
*   实现文件系统读写封装 (`fs-extra`)。
*   重构 `Sidebar` 和 `AssetManager` 以读取本地文件。

### Phase 3: 业务逻辑迁移 (4 Days)
*   将 `geminiService` 的 API 调用逻辑移入 Main Process。
*   实现本地 `TaskQueue`。
*   实现“打开文件夹/工程”的逻辑。

---

**总结**: 
此方案完全去除了服务器依赖，将应用打造为一款标准的**生产力工具**（类似 Blender/Obsidian）。这不仅符合“开源、免费、隐私”的社区价值观，也极大地降低了用户的部署门槛和维护成本。
