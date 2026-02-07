---
alwaysApply: false
description: "涉及 Provider/Key/任务队列/worker/错误码/审计链路时"
---

# 关键链路规则（智能生效）

- 先对齐：优先阅读 `rules.md` 与 `docs/roadmap/Phase9-Execution-Detail.md`，再实施。
- 禁止降级：不得把 Provider 直连、密钥管理、重试逻辑塞回 UI。
- 模型锁定：模型 ID 必须集中定义并带 `MODEL ID LOCKED - ONLY MAINTAINER CAN CHANGE` 注释。
- worker 可靠性：必须保留 lease token、心跳续租、过期回收、幂等提交、退避重试。
- 错误分层：统一 `code/message/context`；不可重试错误直接 dead-letter。
- UI 排障：错误码到可读文案映射不得缺失或绕过。
- 批量重试：默认支持 dry-run 预演；执行动作必须写审计日志。
- 变更证明：涉及任务链路时，提交中必须附回归验证步骤与结果。
