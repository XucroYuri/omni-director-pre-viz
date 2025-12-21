---
alwaysApply: false
globs:
  - "renderer/**"
  - "src/renderer/**"
  - "ui/**"
  - "src/ui/**"
---

# Renderer 边界规则（按文件匹配生效）

- 互查：本规则是 `rules.md` 的 Renderer 落地版；冲突先停手并对齐 `dev/Consensus-Lock.md`。
- 禁止导入/使用：`electron`、`electron/*`、`fs`、`path`、`child_process`、`worker_threads`、`net`、`tls`、`dgram`、`better-sqlite3`、`@google/genai`、`openai` 等。
- 禁止直连外部网络：Renderer 仅可调用 Main 提供的 IPC（或允许时 `127.0.0.1` 本地 HTTP + 会话 token），不得直接请求 `https://aihubmix.com/*`。
- 禁止写入磁盘：文件读写、SQLite、导出/打包、解压缩等必须在 Main 执行并经 IPC 暴露最小能力面。
- UI 只处理展示与交互：不要在 Renderer 实现密钥管理、并发队列、provider 重试/降级、或任何安全敏感逻辑。
