---
alwaysApply: false
description: "当开始新任务、评审、或准备交付时"
---

# 工作流与交付（智能生效）

- 互查：本规则是 `dev/reference_vibe-coding-skill` 的落地版；与 `rules.md` 同时遵守。
- 输入不完整先补问：缺目标/非目标/DoD/红线/输入材料时，先问 1-3 个关键问题。
- 开工先复述口径：实现前复述目标/非目标/约束/验收，并引用权威文件路径（`rules.md`、`dev/Guardrails.md` 等）。
- 禁止虚构验证：未实际运行不得声称“已通过/已修复”；给出可复现验证步骤。
- 变更最小化：一次任务尽量只解决一类问题；禁止未要求的大范围改名/搬迁/换技术栈。
- 交付可审计：按 Change Report 输出：DoD 勾选、改动清单、验证、风险与回滚。
- PR 可审计：按 `.github/pull_request_template.md` 填 `Compliance Check` 并引用 `rules.md`/`.trae/rules/*`。
