<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Omni-Director Pre-viz Workstation

本仓库当前包含一个 **Web SPA 原型**（历史产物）以及一套已锁定的 **Electron Desktop 重构计划**（权威实施标准）。

权威入口（实施与验收以此为准）：
- `dev/Plan-Codex.md`
- `rules.md`
- `dev/Guardrails.md`
- 共识锁定：`dev/Consensus-Lock.md`

## 当前原型（仅供参考）
原型仍是浏览器环境的 Vite/React 项目；其安全与架构不符合最终交付红线（例如“前端零密钥”“aihubmix-only”“Sora-2-only”等），重构时会迁移到 `renderer/` 并由 `main/` 承担所有生成与落盘。

如需本地运行原型（仅用于 UI 参考）：
1. `npm install`
2. `npm run dev`

> 注意：不要在前端 bundle/URL/日志中放入任何真实密钥；最终方案会在桌面端主进程中通过“弹窗输入 + 加密持久化 + 设备绑定失效”管理 aihubmix key。
