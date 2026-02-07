# 文档治理完成报告（2026-02-07）

## 1. 目标
在不破坏历史追溯能力的前提下，完成“主线入口收敛 + 历史计划降噪 + 自动化门禁”三项治理闭环，避免旧计划继续干扰当前 Web First 执行。

## 2. 本轮完成项
1. 文档权威入口统一到 `docs/` 与 `rules.md`。
2. `dev/**/*.md` front-matter `status` 全量补齐并标准化。
3. 历史脚本与日志完成归档迁移：
- `dev/archive/scripts/*`
- `dev/archive/dev-logs/*`
4. 审计体系落地：
- `docs/audit/Legacy-Docs-Ledger.md`
- `docs/audit/Doc-Cleanup-Round-2026-02-07.md`
- `docs/audit/Dev-Status-Frontmatter-Report-2026-02-07.md`
- `docs/audit/Legacy-Path-Reference-Audit-2026-02-07.md`
5. 自动化治理门禁：
- 新增 `scripts/docs-governance-audit.cjs`
- 新增 npm 命令 `npm run docs:audit`
- CI 增加 `Docs governance audit` 步骤
- 新增版本化 hook：`.githooks/pre-push`
- 新增 hook 安装器：`scripts/setup-git-hooks.cjs`

## 3. 验证结果（当前快照）
执行命令：`node scripts/docs-governance-audit.cjs`

结果：通过。
- `dev/**/*.md` 状态字段：缺失 `0`、非法 `0`
- `docs/audit/README.md` 索引缺失项：`0`
- `Legacy-Docs-Ledger` 必需章节存在：`是`
- 活跃文档旧路径引用命中：`0`

## 4. 当前治理边界
1. 本轮不做历史文档物理删除，全部保留追溯能力。
2. 旧计划文档通过 `status` 与入口降级控制误用风险。
3. 自动化门禁仅覆盖文档结构一致性，不替代业务正确性测试。

## 5. 持续治理规则
1. 新增 `docs/audit/*.md` 报告后，必须同步更新 `docs/audit/README.md`。
2. 变更 `dev/*.md` 状态或定位时，必须同步更新 `docs/audit/Legacy-Docs-Ledger.md`。
3. 推送前必须通过 `pre-push` 的 `docs:audit`，CI 失败视为流程阻断。
4. 新主线规划仅写入 `docs/`，不再新增 `dev/` 权威规划文档。

## 6. 后续建议
1. 在分支保护中启用 CI 必过（包含 `Docs governance audit`）。
2. 后续若要“物理删除历史文档”，需先补一轮引用追踪与回滚策略审计。
