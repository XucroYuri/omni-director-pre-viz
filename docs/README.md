# Omni-Director 文档总入口（2026 重规划）

## 1. 文档目标
本目录用于替代分散的历史计划文档，形成唯一可执行入口，避免“旧方案误导当前开发”。

当前项目主线：**Phase 9 Web First（Next.js + Worker + Postgres + Object Storage）**。

## 2. 权威层级
1. `docs/roadmap/Execution-Roadmap-2026.md`
- 当前阶段、目标、验收门禁、下一步执行顺序。
2. `docs/roadmap/Phase9-Execution-Detail.md`
- Phase 9 分阶段细则与 9.2.x 实施基线（含 worker、dead-letter、审计）。
3. `docs/governance/Risk-Audit-Checklist-2026.md`
- 高/中/低风险清单，明确可删与不可删项以及执行门槛。
4. `docs/audit/README.md`
- 审计报告总索引（台账与审计报告导航入口）。
5. `docs/audit/Legacy-Docs-Ledger.md`
- 历史文档状态台账，避免重复阅读已过期计划。
6. `rules.md`
- 业务与安全红线（Web First 口径）。

## 3. 使用规则
- 新需求或新阶段规划，优先更新本目录，不再新增 `dev/*` 权威计划。
- `dev/` 目录视为历史沉淀区（legacy）；可查阅，但不作为默认实施依据。
- 任何跨阶段改动必须同时更新：
  - 路线图中的阶段状态
  - 风险审计中的风险级别/处置状态

## 4. 当前阶段结论（快照）
- Phase 9.1 基础骨架：已完成。
- Phase 9.2 worker 主链路：已完成到 dead-letter 批量重试 + 审计日志能力。
- 下一执行重点：
  1. 9.2.7+ 观测面补全（指标、报警、自动修复边界）
  2. 9.3 协作与权限模型（多用户）
  3. 9.4 迁移、灰度与退役 Electron

## 5. 历史资料入口
- 历史计划目录：`dev/`
- 历史归档目录：`dev/archive/`
- 分支级历史重构提案：`dev/branch-refactor-plan/`
- 本轮文档清理记录：`docs/audit/Doc-Cleanup-Round-2026-02-07.md`
