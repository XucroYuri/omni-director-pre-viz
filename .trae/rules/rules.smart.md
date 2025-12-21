---
alwaysApply: false
description: "涉及 Provider/Key/IPC/并发/输出/Prompt/参考图语义时"
---

# 关键链路规则（智能生效）

- 互认：与 `rules.md` 同时生效；不一致先停手对齐并提“待拍板”。
- 先对齐：看 `dev/Consensus-Lock.md`/`dev/Plan-Codex.md`/`rules.md`；无结论先提问再写。
- IPC先行：协议/类型放 `shared/`；禁 `any`；错误码可追踪（含provider/模型/请求id）。
- Key 不可降级：不随包；缺失/失效必弹窗；加密落盘；设备变更即销毁并重录入。
- Provider：接口预留多服务商/主备，但实现仍 aihubmix-only；并发 LLM10/IMG5/VID3；429 降级+冷却恢复。
- 模型ID：集中定义 + `MODEL ID LOCKED - ONLY MAINTAINER CAN CHANGE`；非维护者改动=阻断。
- Prompt：发送前强制“预设前缀+动态内容”；引用资产图写清性质与文件名。
- 输出：命名/目录稳定；ZIP 默认不含视频（勾选才含）。
