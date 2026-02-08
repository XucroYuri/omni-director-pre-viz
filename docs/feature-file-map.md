# 文件级映射表（功能点 → 组件路径）

> 目的：让 PM/研发能快速定位“功能点对应的代码位置”。

## 1. 核心流程

- 脚本输入/保存/拆解
  - `src/renderer/App.tsx`
  - `apps/web/src/app/episodes/[episodeId]/EpisodeDetailClient.tsx`

- 镜头列表与母图渲染
  - `src/renderer/components/MatrixPromptEditor.tsx`
  - `apps/web/src/app/episodes/[episodeId]/EpisodeDetailClient.tsx`

- 视频生成与预览
  - `src/renderer/components/MatrixPromptEditor.tsx`

- 导出
  - `src/renderer/components/Sidebar.tsx`
  - `src/main/services/exportService.ts`

## 2. 任务与队列

- 任务状态面板
  - `src/renderer/components/TaskPanel.tsx`

- 任务队列逻辑
  - `src/main/queue/TaskQueue.ts`
  - `src/main/queue/TaskRunner.ts`

- Ops 控制台（Web）
  - `apps/web/src/app/ops/queue/page.tsx`

## 3. 数据与持久化

- DB 读写
  - `src/main/services/dbService.ts`

- Episode/Shot/Asset Repo
  - `src/main/db/repos/episodeRepo.ts`
  - `src/main/db/repos/shotRepo.ts`
  - `src/main/db/repos/assetRepo.ts`

## 4. IPC 与协议

- IPC 通道定义
  - `src/shared/ipc.ts`

- IPC Handler
  - `src/main/ipc.ts`

- Preload
  - `src/preload/preload.ts`

## 5. 媒体存储与访问

- 媒体写入与 URL 解析
  - `src/main/services/mediaService.ts`

- 自定义协议
  - `src/main/services/mediaProtocol.ts`
  - `src/main/main.ts`

## 6. i18n 覆盖范围

- Renderer 文案
  - `src/renderer/App.tsx`
  - `src/renderer/components/Sidebar.tsx`
  - `src/renderer/components/MatrixPromptEditor.tsx`
  - `src/renderer/components/PromptOptimizer.tsx`

- Web 文案
  - `apps/web/src/app/page.tsx`
  - `apps/web/src/app/episodes/page.tsx`
  - `apps/web/src/app/episodes/[episodeId]/EpisodeDetailClient.tsx`
  - `apps/web/src/app/ops/queue/page.tsx`
