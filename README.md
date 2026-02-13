<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Omni-Director Pre-viz Workstation

本仓库已进入 **Electron Desktop 重构迭代**。当前主线为 Electron 骨架（Main/Preload/Renderer）+ 本地门禁体系（Docs-as-Gates）。

权威入口（实施与验收以此为准）：
- `dev/Plan-Codex.md`
- `rules.md`
- `dev/Guardrails.md`
- 共识锁定：`dev/Consensus-Lock.md`

## 本地运行（开发）
1. `npm install`
2. `npm run dev`

`npm run dev` 会同时启动：
- `vite`（Renderer dev server，`127.0.0.1:3000`）
- `electron`（Main Process，加载 `window.api` IPC 桥接）

## Phase9 Web（Docker 依赖隔离）
推荐使用 Docker 承载 Web 依赖，避免宿主机 `node_modules/.npm-cache` 持续膨胀：

1. `npm run phase9:infra:up`
2. `npm run phase9:web:docker:install`
3. `npm run phase9:web:docker:db:init`
4. `npm run phase9:web:docker:dev`
5. `npm run phase9:web:docker:worker`

## 仓库清理
- 清理本地构建产物与缓存：`npm run clean:local`
- 清理并回收当前项目 Docker volumes：`npm run clean:local:docker`

## 开发环境变量（仅本地）
桌面端生成能力在 Main Process 读取密钥，默认从环境变量/本地 `.env.local` 注入（`.env.example` 提供模板）：
- `AIHUBMIX_API_KEY`

输出目录（开发默认）：
- `app.getPath('userData')/output`（可用 `OMNI_OUTPUT_DIR` 覆盖）

> 注意：不要在前端 bundle/URL/日志中放入任何真实密钥；最终方案会在桌面端主进程中通过“弹窗输入 + 加密持久化 + 设备绑定失效”管理 aihubmix key。
