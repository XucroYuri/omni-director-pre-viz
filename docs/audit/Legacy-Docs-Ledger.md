# 历史文档状态台账（Legacy Docs Ledger）

状态定义：
- `ACTIVE`：当前仍可直接指导实施。
- `REFERENCE`：保留背景价值，不作为默认实施依据。
- `SUPERSEDED`：已被新主线替代，不再直接使用。
- `ARCHIVED`：历史留档，仅用于追溯。

## 1. dev 根目录

| 文档 | 状态 | 判定 | 替代/归并去向 | 处理建议 |
| --- | --- | --- | --- | --- |
| `dev/README.md` | SUPERSEDED | 原“权威入口”已分散且偏 Electron | `docs/README.md` | 保留最小跳转说明 |
| `dev/Plan-Codex.md` | SUPERSEDED | Electron 本地优先主线已被 Web First 主线替代 | `docs/roadmap/Execution-Roadmap-2026.md` | 冻结，不再增量维护 |
| `dev/Progress-vs-Plan-Codex.md` | REFERENCE | 具备历史差距分析价值 | `docs/audit/Legacy-Docs-Ledger.md` | 保留供回溯 |
| `dev/Plan-Electron-Standalone.md` | REFERENCE | Electron 路线历史参考，不再作为默认主线 | `docs/roadmap/Execution-Roadmap-2026.md` | 冻结 |
| `dev/Phase4-Step2-Revised-Spec.md` | ARCHIVED | 旧阶段细节，已过时 | 无 | 归档保留 |
| `dev/Phase5-Step1-Schema-Spec.md` | ARCHIVED | 旧数据层计划未按当前主线推进 | 无 | 归档保留 |
| `dev/Phase8-Roadmap-RFC.md` | REFERENCE | 有阶段化思路价值，但执行背景已变更 | `docs/roadmap/Execution-Roadmap-2026.md` | 保留参考 |
| `dev/Phase8-Spec.md` | SUPERSEDED | 基于 Electron 目标，不再匹配当前方向 | `docs/roadmap/Execution-Roadmap-2026.md` | 冻结 |
| `dev/Phase9-Web-First-RFC.md` | REFERENCE | 仍是 Web First 的来源说明 | `docs/roadmap/Execution-Roadmap-2026.md` | 保留来源说明 |
| `dev/Phase9-Web-Migration-Plan.md` | REFERENCE | 已并入 docs 主路线图细则 | `docs/roadmap/Phase9-Execution-Detail.md` | 冻结历史快照 |
| `dev/Phase9-1-Bootstrap-Report.md` | REFERENCE | 已完成阶段报告 | `docs/roadmap/Execution-Roadmap-2026.md` | 保留快照 |
| `dev/Phase9-1-Lightweight-Refactor.md` | REFERENCE | 已完成局部重构记录 | `docs/governance/Risk-Audit-Checklist-2026.md` | 保留快照 |
| `dev/Phase9-2-Worker-Kickoff.md` | REFERENCE | 已并入 docs 主路线图细则 | `docs/roadmap/Phase9-Execution-Detail.md` | 冻结历史快照 |
| `dev/Consensus-Lock.md` | REFERENCE | 具备历史共识价值，但架构结论过时 | `docs/README.md` | 保留但不作默认依据 |
| `dev/Guardrails.md` | REFERENCE | 安全门禁仍有价值，架构描述需后续 Web 化 | `rules.md` + `docs/governance/*` | 后续拆分更新 |
| `dev/migration_review.md` | REFERENCE | 历史评估报告 | `docs/audit/Legacy-Docs-Ledger.md` | 保留追溯 |
| `dev/log.md` | REFERENCE | 日志索引入口（历史条目已迁移） | `dev/archive/dev-logs/*` | 仅保留索引用途 |
| `dev/archive/scripts/verify_db.js` | ARCHIVED | 无入口调用的历史验证脚本 | `docs/audit/Doc-Cleanup-Round-2026-02-07.md` | 已归档 |
| `dev/archive/scripts/verify_export.js` | ARCHIVED | 无入口调用的历史验证脚本 | `docs/audit/Doc-Cleanup-Round-2026-02-07.md` | 已归档 |

## 2. dev/archive

| 文档 | 状态 | 判定 | 处理建议 |
| --- | --- | --- | --- |
| `dev/archive/Plan-Codex-Integration-Addendum.md` | ARCHIVED | 历史补充方案 | 保留 |
| `dev/archive/Plan-FullStack-BFF.md` | ARCHIVED | 历史路线草案 | 保留 |
| `dev/archive/Plan-Gemini3pro.md` | ARCHIVED | 历史模型与方案草案 | 保留 |
| `dev/archive/progress_review.md` | ARCHIVED | 历史评审 | 保留 |
| `dev/archive/technical_review.md` | ARCHIVED | 历史评审 | 保留 |
| `dev/archive/dev-logs/log_2024-05.md` | ARCHIVED | 月度历史日志归档 | `dev/log.md` | 保留 |
| `dev/archive/dev-logs/log_2025-12.md` | ARCHIVED | 月度历史日志归档 | `dev/log.md` | 保留 |

## 3. dev/branch-refactor-plan

| 文档 | 状态 | 判定 | 处理建议 |
| --- | --- | --- | --- |
| `dev/branch-refactor-plan/README.md` | ARCHIVED | 分支阶段性产物 | 保留 |
| `dev/branch-refactor-plan/01_architecture_audit.md` | ARCHIVED | 历史分支审计 | 保留 |
| `dev/branch-refactor-plan/02_image_gen_fix.md` | ARCHIVED | 历史修复计划 | 保留 |
| `dev/branch-refactor-plan/03_video_gen_strategy.md` | ARCHIVED | 历史视频策略草案 | 保留 |

## 4. 结论
1. 不建议一次性删除 `dev` 历史文件，先通过状态台账降低误用风险。
2. 新增计划与执行报告统一进入 `docs/`，`dev/` 停止扩张。
3. `dev/Phase9-*` 的在用内容已并入 `docs/roadmap/Phase9-Execution-Detail.md`，后续仅维护 docs 主线。

## 5. Front-Matter 完整性检查
目标：确保 `dev/**/*.md` 都包含 front-matter `status` 字段，避免状态漂移。

当前结果（2026-02-07）：
- 扫描总数：`32`
- 缺失数量：`0`
- 详见：`docs/audit/Dev-Status-Frontmatter-Report-2026-02-07.md`

复检命令：
```bash
node -e 'const fs=require(\"fs\"),path=require(\"path\");function w(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=path.join(d,e.name);return e.isDirectory()?w(p):e.isFile()&&p.endsWith(\".md\")?[p]:[]})};const files=w(\"dev\");const miss=files.filter(p=>{const t=fs.readFileSync(p,\"utf8\").split(/\\r?\\n/);if((t[0]||\"\").trim()!==\"---\")return true;let ok=false;for(let i=1;i<Math.min(t.length,30);i++){if(t[i].trim()===\"---\"){ok=t.slice(1,i).some(l=>l.trim().startsWith(\"status:\"));break}}return !ok});console.log({total:files.length,missing:miss.length});if(miss.length)console.log(miss.join(\"\\n\"));'
```
