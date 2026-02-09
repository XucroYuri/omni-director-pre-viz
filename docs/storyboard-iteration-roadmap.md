# Storyboard Iteration Roadmap

## Goal
将当前镜头编辑器从“提示词驱动”升级为“影视动画 storyboard 工作流驱动”，覆盖从脚本拆解到预演交付的完整闭环。

## Industry-Aligned Model
建议将每个镜头下的 panel 结构化为：

- `panelId`: `Panel_01` 风格编号
- `camera`: 景别 + 机位 + 镜头运动
- `action`: 角色动作与走位
- `composition`: 构图/前中后景/视觉重心
- `dialogueCue`: 台词或表演节奏提示
- `durationSec`: 面板预计时长
- `transition`: cut/dissolve/whip pan 等转场
- `sfxBgmCue`: 声音提示
- `intent`: 叙事意图（信息传递/情绪/冲突）

## Iteration Tracks

### 1) Storyboard Data Schema
- 在 `Shot` 下新增 `storyboardPanels` 数组，替代纯字符串 `matrixPrompts` 的单一表达。
- 兼容旧数据：读取旧 `matrixPrompts` 时自动迁移到 `storyboardPanels.prompt`。
- 继续保留 `matrixPrompts` 作为向后兼容字段，发布两版后再清理。

### 2) Panel Script Editor
- 编辑器升级为“结构化字段 + 文本模式”双视图：
  - 结构化：camera/action/duration/transition 分栏。
  - 文本模式：`[Panel_xx]` 连续编辑，用于快速批量改稿。
- 为每个 panel 增加“完成度”校验规则（必填项、时长范围、资产绑定完整度）。

### 3) Continuity & Coverage QA
- 增加 continuity 检查器：
  - 180 度轴线风险提示
  - 镜头方向跳变
  - 角色位置连续性断裂
  - 服化道引用缺失
- 增加 coverage 分析：
  - `wide / medium / close-up` 覆盖比例
  - 主角出镜连续性
  - 关键动作是否具备建立镜头与反应镜头

### 4) Timing & Animatic
- 基于 `durationSec` 自动生成 shot-level timing 条带。
- 支持按 panel 级时长拼接 animatic，导出 EDL/CSV。
- 对接任务队列时，将视频任务由“按角度”切换为“按 panel”。

### 5) Review & Delivery
- 引入 `reviewStatus`（draft / in-review / approved）与批注。
- 导出 Storyboard Package：
  - 面板图、脚本、时长、资产引用、continuity 报告。
- 支持制片评审视图（只读 + 批注 + 问题追踪）。

## Recommended Milestones

1. `M1`：Schema 升级 + 旧数据迁移 + 双模式编辑器。
2. `M2`：Continuity/Coverage 自动检查 + 闭环评分。
3. `M3`：Timing/Animatic 强化 + 可交付导出模板。
