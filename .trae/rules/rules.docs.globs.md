---
alwaysApply: false
globs:
  - "docs/**/*.md"
  - "dev/**/*.md"
  - "rules.md"
  - ".trae/rules/**/*.md"
---

# 文档一致性（按文件匹配生效）

- 修改文档规则时，需同步检查 `rules.md` 与 `.trae/rules/*` 一致性。
- 涉及阶段口径时，优先对齐 `docs/roadmap/*`，避免回写到 `dev/*` 作为新权威。
- 历史文档必须明确标注状态（ACTIVE/REFERENCE/SUPERSEDED/ARCHIVED）。
- 规则与流程结论要可追溯到具体文件路径，避免口头约定。
