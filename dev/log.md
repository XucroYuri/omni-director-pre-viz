
# 开发者日志 (Developer Log)

记录约定（建议）：
- 日常追加可继续写在本文件；当单次迭代内容较多时，建议新建 `dev/log_YYYYMMDD_topic.md`，并按 `rules.md` 的“dev 文档模板”记录。
- 交付给 PM 的摘要可直接用 `dev/reference_vibe-coding-skill/templates/Change-Report.md`。

## 2024-05-20: 初始化架构
- **任务**: 搭建基础 SPA 结构。
- **决策**: 采用侧边栏布局，左侧为剧本与镜头列表，右侧为资产配置，中心为矩阵编辑器。
- **注意**: Gemini 3 Pro Image 在生成 4K 图片时耗时较长，需在 UI 上提供明确的排队状态反馈。

## 2024-05-20: 核心服务封装
- **任务**: 封装 `geminiService.ts`。
- **逻辑**: 实现 `breakdownScript` (Text-to-JSON) 和 `generateGridImage` (Text-to-Image)。
- **切图逻辑**: 引入 Canvas 离屏渲染进行 3x3 网格切分。

## 2025-12-21: 重构共识锁定 (Phase 1 启动前)
- **事件**: 完成 C队 (Main) 与 G队 (Aux) 的方案对齐。
- **成果**: 
  - 锁定 `dev/Consensus-Lock.md`。
  - 确认架构迁移至 **Electron Local-First**。
  - 确认数据层级 **Season -> Episode -> Beat -> Shot**。
  - 确认 **aihubmix-only** 与 **Zero-Secret** 安全红线。
- **状态**: G队已同意启动 Phase 1 (Skeleton)。
