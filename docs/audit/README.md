# 审计报告总索引（Audit Index）

## 1. 作用
本目录用于沉淀文档治理与历史清理过程中的审计结果，避免“清理动作不可追溯”。

## 2. 核心基线文档
1. `docs/audit/Legacy-Docs-Ledger.md`
- 历史文档状态台账（`ACTIVE/REFERENCE/SUPERSEDED/ARCHIVED`）。

## 3. 过程审计报告（按日期）
1. `docs/audit/Doc-Cleanup-Round-2026-02-07.md`
- 2026-02-07 文档清理轮次记录与后续待办。
2. `docs/audit/Dev-Status-Frontmatter-Report-2026-02-07.md`
- `dev/**/*.md` front-matter `status` 字段补齐报告。
3. `docs/audit/Legacy-Path-Reference-Audit-2026-02-07.md`
- 历史路径引用自动化审计（已修复/可接受/待处理）。
4. `docs/audit/Docs-Governance-Completion-Report-2026-02-07.md`
- 文档治理闭环完成报告（入口收敛、门禁接线、验证快照）。

## 4. 命名约定
建议新增报告按以下格式命名：
- `Topic-Report-YYYY-MM-DD.md`
- `Topic-Audit-YYYY-MM-DD.md`

## 5. 维护要求
1. 新增审计报告后，必须同步更新本索引。
2. 与历史文档状态相关的变更，必须同步更新 `Legacy-Docs-Ledger.md`。

## 6. 自动化校验
1. 本地运行：`node scripts/docs-governance-audit.cjs`
2. CI 会在构建前自动执行该校验，失败即阻断后续流程。
