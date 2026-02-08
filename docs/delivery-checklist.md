# 交付清单与验收标准（Vibe Coding 友好）

## 0. 一句话目标

在不破坏现有核心流程的前提下，补齐商业可交付所需的 UX、稳定性、可靠性与中文 i18n 能力。

## 1. 非目标

- 不做大规模重构或技术栈替换。
- 不引入新的商业依赖或云服务。
- 不改变主业务流程（脚本 → 拆解 → 资产 → 母图 → 视频 → 导出）。

## 2. 约束/红线（引用权威文档）

- `rules.md`
- `dev/Guardrails.md`
- `dev/Consensus-Lock.md`

## 3. 交付清单（按优先级）

### P0 商业可交付

1) 统一消息体系（替换 alert/confirm）
- 输出：全局 toast + 错误详情弹窗
- 影响：Renderer + Web
- 参考组件位置：
  - `src/renderer/App.tsx`
  - `src/renderer/components/Sidebar.tsx`
  - `src/renderer/components/MatrixPromptEditor.tsx`
  - `apps/web/src/app/ops/queue/page.tsx`

2) 关键流程状态规范落地
- 输出：脚本/拆解/母图/视频/导出均具备 Idle/Loading/Success/Error
- 影响：Renderer + Web
- 参考页面位置：
  - `apps/web/src/app/episodes/page.tsx`
  - `apps/web/src/app/episodes/[episodeId]/EpisodeDetailClient.tsx`

3) 任务状态一致化
- 输出：任务队列与镜头状态一致（Queued/Running/Failed/Completed）
- 影响：Renderer
- 参考组件位置：
  - `src/renderer/components/TaskPanel.tsx`
  - `src/renderer/components/MatrixPromptEditor.tsx`

4) 导出可靠性与可验证
- 输出：导出结果提示路径 + manifest 校验提示 + 错误码
- 影响：Renderer + Main
- 参考位置：
  - `src/main/services/exportService.ts`
  - `src/renderer/components/Sidebar.tsx`

### P1 体验优化

5) 新手引导与空状态体系
- 输出：脚本/镜头/资产/视频空状态统一引导
- 参考位置：
  - `apps/web/src/app/episodes/page.tsx`
  - `src/renderer/components/MatrixPromptEditor.tsx`

6) 长耗时操作反馈
- 输出：拆解/母图/视频显示预计时长 + 后台执行提示
- 参考位置：
  - `src/renderer/components/MatrixPromptEditor.tsx`
  - `apps/web/src/app/ops/queue/page.tsx`

7) 术语与按钮文案统一
- 输出：关键步骤命名一致（避免中英混排）

### P2 运营与合规

8) 诊断日志导出 + 支持入口
- 输出：失败提示含“导出诊断/联系支持”

9) AI 生成/外部 API/数据存储提示
- 输出：最小合规提示

### P3 可访问性与一致性

10) 可访问性补齐
- 输出：键盘可达/焦点可视/对比度达标

11) 组件规范化
- 输出：按钮/提示/错误/空状态视觉一致

## 4. 验收标准（DoD）

### 通用验收

- 所有关键动作具备 Idle/Loading/Success/Error 状态。
- 所有失败具备“重试/查看详情/回滚”路径。
- 无 `alert/confirm`，统一走消息体系。
- 任务状态与 UI 展示一致。
- 导出含可验证信息（路径/manifest/错误码）。
- 错误提示包含可行动作（重试/查看详情/导出诊断）。
- 空状态与引导可独立驱动用户完成下一步。

### P0 关键用例

1) 脚本拆解失败 → 有错误提示 + 可重试，不丢数据。
2) 母图生成失败 → 可重试，按钮禁用时有原因提示。
3) 视频生成失败 → 可重试 + 查看详情。
4) 导出失败 → 错误码 + 诊断导出入口。

## 5. 验收用例（操作路径）

### 用例 A：脚本 → 拆解 → 母图

1) 新建 Episode，粘贴脚本
2) 点击“拆解”并观察状态提示
3) 对任一镜头点击“渲染母图”
4) 期望：全链路状态可见，失败可重试

### 用例 B：母图 → 视频

1) 已生成母图
2) 触发视频生成
3) 期望：显示预计时长/队列状态；失败可重试

### 用例 C：导出

1) 导出结果
2) 期望：成功提示路径与 manifest；失败提示错误码与诊断入口

### 用例 D：任务队列一致性

1) 提交任务（拆解/母图/视频）
2) 观察 TaskPanel 与镜头状态
3) 期望：Queued/Running/Failed/Completed 一致

## 6. 风险与回滚

- 风险：消息体系替换可能遗漏旧的 alert/confirm。
- 风险：状态提示过多影响注意力，需要分级展示。
- 回滚：保留旧逻辑开关或逐步替换；优先覆盖主路径。

## 7. 输入材料

- `docs/ux-copy-states.md`
- `docs/i18n-plan.md`

## 8. 质量门禁（Vibe Coding）

- 所有改动必须可追溯（目标/非目标/验收/风险）。
- 关键路径必须提供可复现验证步骤。
