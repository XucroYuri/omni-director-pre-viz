# 文档低风险清理记录（2026-02-07）

## 已执行
1. 新增 `docs/roadmap/Phase9-Execution-Detail.md`，合并 Phase 9 迁移与 worker 实施细则。
2. `dev/Phase9-*` 相关文档统一降级为 `REFERENCE` 并添加跳转说明。
3. 根 `README.md` 与 `dev/README.md` 更新权威入口到 `docs/`。
4. `rules.md` 重写为 Web First 口径，保留关键安全与质量红线。
5. `dev/verify_db.js`、`dev/verify_export.js` 经调用扫描后迁移归档到 `dev/archive/scripts/`。
6. `dev/log.md` 拆分为日志索引，并将历史条目按月份归档到 `dev/archive/dev-logs/`。
7. 历史文档中的“旧权威入口”措辞已补充“历史口径/历史参考”说明。
8. `.trae/rules/*` 已与 Web First 规则对齐，不再默认引用 `dev/*` 作为当前实施入口。
9. `dev/archive/*` 主要文档已补充统一“历史文档说明”。
10. `dev/archive/*`、`dev/branch-refactor-plan/*`、部分旧路线文档已补统一 front-matter `status` 字段。
11. `dev/**/*.md` 状态字段补齐完成，详见 `docs/audit/Dev-Status-Frontmatter-Report-2026-02-07.md`。
12. 历史路径引用自动化审计已完成，详见 `docs/audit/Legacy-Path-Reference-Audit-2026-02-07.md`。
13. `docs/audit/Legacy-Docs-Ledger.md` 新增 front-matter 完整性检查节与复检命令。
14. `docs/audit/README.md` 已建立审计报告总索引，并在 `docs/README.md` 增加入口。

## 本轮未做（故意保留）
1. 未删除任何历史文档文件，只做状态降级与入口收敛。
2. `dev/archive/*` 保持原样，避免丢失历史追溯线索。

## 下一轮可清理项（低风险）
1. 统一历史文档内部“历史来源链接”标记样式（例如统一 `[历史来源]` 前缀）。
2. 对 `docs/audit/*` 报告增加“最近更新日期”字段，便于后续自动排序。
