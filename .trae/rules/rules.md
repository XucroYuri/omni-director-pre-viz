---
alwaysApply: true
---

# 基础规则（始终生效）

- 双入口：同时遵守 `rules.md` + `.trae/rules/*` + `dev/Guardrails.md`。
- 权威：`dev/Consensus-Lock.md`/`dev/Plan-Codex.md`/`rules.md`；冲突先停手提问。
- 零密钥：仓库/日志禁 Key/Token/私钥/证书；密钥只在 Main/后端。
- Provider/模型：aihubmix；TEXT=`gemini-3-flash-preview`、IMAGE=`gemini-3-pro-image-preview`、VIDEO=`sora-2`。
- 生图：3x3 GridMaster→Angle_{01-09}；单 Angle 仅修正。
- Preset：Image/Video 两套；Angle 文本不写风格；主进程顶层强制注入。
- 边界：Renderer 禁 Node/Electron；I/O 走 Main+IPC。
- 输出：统一写入 `output/`；ZIP 默认不含视频（勾选才含）。
- Prompt：默认中文（影视术语例外）；忠实原文再影视化。
- 参考图：写清性质+文件名+用途；Sora-2 单参考图需说明作用。
- 离线：禁 CDN/importmap/在线字体 作为前置。
