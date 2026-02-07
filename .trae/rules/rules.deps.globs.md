---
alwaysApply: false
globs:
  - "package.json"
  - "**/package.json"
  - "docker-compose.yml"
  - "electron-builder.*"
  - "**/electron-builder.*"
---

# 依赖管理（按文件匹配生效）

- 依赖新增必须与 Web First 架构一致，避免引入无必要的并行技术栈。
- 禁止为“临时方便”把 provider SDK/密钥逻辑放回前端。
- 改动依赖后需确认本地与云端运行模型不分叉（至少保证本地 compose + web 可运行）。
- 任务链路相关依赖变更后，需执行对应回归或冒烟验证。
