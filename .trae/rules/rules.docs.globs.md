---
alwaysApply: false
globs:
  - "dev/**/*.md"
  - "rules.md"
  - ".trae/rules/**/*.md"
---

# 文档一致性（按文件匹配生效）

- 双向索引：修改本文档集合时，需同步检查 `rules.md` 与 `.trae/rules/*` 的一致性。
- 不得自相矛盾：与 `dev/Consensus-Lock.md`/`dev/Plan-Codex.md`/`rules.md` 冲突时必须先提问或修正文档再继续。
- 结论要“可拍板”：对存在多选项/不确定性内容，用“已确认/待拍板”显式标注，并写出默认策略与理由。
- 引用要可追溯：新增规则/门禁需落到具体文件路径；避免只有对话没有落盘。
