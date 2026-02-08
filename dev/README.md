# dev 目录说明（当前权威文档入口）

本目录用于“异步协作 + 方案与规范沉淀”。为避免多方案互相干扰，现阶段仅以下文档视为**权威/在用**：

- `dev/Plan-Codex.md`：最终版重构方案、技术细节与任务分解（对齐需求红线）
- `rules.md`：开发规范与硬红线（Agent/开发者必须遵守）
- `dev/Guardrails.md`：关键参数/安全边界的硬门禁说明（配合 `.github/` 门禁）
- `dev/reference_vibe-coding-skill/Vibe-Coding-Standard.md`：PM/Agent 协作标准（任务输入/交付格式/质量门禁模板）
- `dev/Progress-vs-Plan-Codex.md`：当前代码现状 vs 计划差距盘点（仅用于迁移阶段对照）
- `dev/Consensus-Lock.md`：C队（ChatGPT系主力开发 Agent）×G队（Gemini系辅助/审查 Agent）×维护者（@XucroYuri）“共识锁定记录”（开工前与实施期同步口径）

迭代优化索引（执行侧入口）：

- `dev/Iteration-Index.md`

参考资料（不作为权威要求，但可用于复盘）：

- `dev/migration_review.md`：G队全量代码审查与迁移评估
- `dev/Plan-Electron-Standalone.md`：Electron 桌面化/打包实践参考（仅供参考；实现与验收仍以 `dev/Plan-Codex.md` + `rules.md` 为准）
- `dev/log.md`：过程记录（可继续追加或按日期拆分）

历史归档（不应再作为实施依据）：

- `dev/archive/`：旧方案/旧评审/历史版本文档
