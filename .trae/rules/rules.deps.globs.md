---
alwaysApply: false
globs:
  - "package.json"
  - "**/package.json"
  - "electron-builder.*"
  - "**/electron-builder.*"
---

# 依赖管理（按文件匹配生效）

- 运行时依赖必须在 `dependencies`（Main 会调用且需随包，例如 `better-sqlite3`/`fs-extra`/`p-queue`/`electron-updater`）。
- 构建/开发工具放 `devDependencies`（例如 `electron`/`electron-builder`/`vite`/`typescript`）。
- 禁止为了“方便”把 provider SDK/密钥逻辑塞回 Renderer；仍需满足 `rules.md` 与 `.trae/rules/*`。
