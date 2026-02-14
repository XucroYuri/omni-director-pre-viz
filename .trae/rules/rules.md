---
alwaysApply: true
---

# 基础规则（始终生效）

- 双入口：同时遵守 `rules.md` + `.trae/rules/*` + `docs/*`。
- 权威顺序：`rules.md` -> `docs/roadmap/Phase9-Execution-Detail.md` -> `docs/roadmap/Execution-Roadmap-2026.md` -> `docs/governance/Risk-Audit-Checklist-2026.md`。
- 历史文档：`dev/*` 仅可追溯，不作为默认实施依据。
- 零密钥：仓库/日志禁 Key/Token/私钥；Provider 调用仅服务端/API/worker。
- Provider/模型：aihubmix-only；TEXT=`gemini-3-flash-preview`、IMAGE=`gemini-3-pro-image-preview`、VIDEO=`sora-2`。
- 生图：主路径为 3x3 GridMaster -> Angle_{01-09}；单 Angle 仅修正。
- 任务：必须走 `queued/running/completed/failed/cancelled` 状态机，保留 lease/heartbeat/recovery。
- 错误：统一 `code/message/context`，并维护 UI 可读文案映射（参数缺失/资源不存在/前置条件不满足）。
- 运维：dead-letter 批量重试需支持过滤+预览+精准 taskIds；审计日志需支持过滤/分页/导出/TTL 清理。
- 输出：按项目层级聚合，交付包含命名规范 + manifest + ZIP。
