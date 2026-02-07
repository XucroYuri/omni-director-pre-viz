---
alwaysApply: false
globs:
  - "renderer/**"
  - "src/renderer/**"
  - "ui/**"
  - "src/ui/**"
  - "apps/web/src/**/*.tsx"
---

# 前端边界规则（按文件匹配生效）

- 与 `rules.md` 同时生效；冲突以 `rules.md` 为准。
- 禁止在前端代码中持有或拼接 Provider Key。
- 禁止前端直连 `https://aihubmix.com/*`；请求应走服务端 API。
- 禁止在前端实现 provider 重试/降级、任务调度、审计写入等后端职责。
- UI 只处理展示与交互，任务编排与执行由 API/worker 负责。
