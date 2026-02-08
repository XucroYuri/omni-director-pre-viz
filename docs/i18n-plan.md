# i18n 中文完整支持规范（Vibe Coding 友好）

## 0. 一句话目标

实现 Renderer + Web 全量中文支持，并确保未来迭代不再出现硬编码文案。

## 1. 非目标

- 不引入重型国际化 SaaS。
- 不做复杂的多语系回译流程。

## 2. 选型建议

- Renderer：`i18next + react-i18next`
- Web（Next.js）：`next-intl` 或 `next-i18next`
- 统一消息源：`messages/zh-CN.json`, `messages/en.json`

## 2.1 目录建议

- Renderer：`src/renderer/locales/zh-CN.json`, `src/renderer/locales/en.json`
- Web：`apps/web/messages/zh-CN.json`, `apps/web/messages/en.json`

## 3. 覆盖范围

- 所有 UI 文案（按钮、标题、空状态、错误、提示、占位符）。
- 所有状态提示（Idle/Loading/Success/Error）。
- 所有导出/诊断/合规提示。

## 4. 落地步骤

1) 建立消息表结构（按模块分组）
2) 替换硬编码文案为 `t('...')`
3) 增加语言切换入口（设置/顶部）
4) CI 增加“硬编码文案扫描”

## 4.1 关键覆盖清单

- 所有按钮/标题/描述/提示语
- 空状态/错误/成功
- 下载/导出/任务状态
- 合规/免责声明/诊断入口

## 5. 验收标准

- 100% 文案来自消息表。
- 运行时切换生效。
- 日期/数字/单位符合 zh-CN 格式。

## 6. 术语表（建议）

- Breakdown：拆解
- Matrix：母图
- Shot：镜头
- Asset：资产
- Export：导出
- Queue：任务队列

## 7. 风险与回滚

- 风险：替换不彻底导致中英混排。
- 回滚：保留英文默认值，逐步替换。

## 8. QA 清单

- zh-CN 全覆盖检查（无硬编码）
- 语言切换实时生效
- 关键路径中文无缺失
