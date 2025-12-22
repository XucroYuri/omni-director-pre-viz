# Phase 4 Step 2 (Revised): 多模态一致性架构升级方案

**状态**: 待确认 (Draft)
**作者**: G 队 (Aux)
**日期**: 2025-12-22
**关联**: `dev/Plan-Codex.md`, `feat/phase4-step2-consistency`

---

## 1. 背景与目标 (Why)

原 Phase 4 Step 2 仅关注“文本 Prompt 资产注入”。根据 XucroYuri 的反馈，用户实际操作中已验证了 **Sora-2 的“母图生视频” (Matrix Video)** 能力，且提出了 **“拼贴生视频” (Asset Video)** 的高阶需求。

为了避免架构反复，我们决定将 Step 2 的 Scope 升级为 **“多模态一致性架构预埋”**，在实现文本注入的同时，为多种视频输入模式预留接口与 UI 入口。

## 2. 核心变更点 (What)

### 2.1 视频生成输入模式标准化 (Video Input Standardization)

后端 `generateShotVideo` (及底层 `gemini.ts` / `ipc.ts`) 将不再假设输入只是单张切片，而是支持多种模式：

| 模式 | 代码枚举 | 描述 | 输入数据 | 适用场景 |
| :--- | :--- | :--- | :--- | :--- |
| **Slot Video** (现有) | `IMAGE_FIRST_FRAME` | 单格切片作为首帧 | `splitImages[index]` | 单镜头微调、特写生成 |
| **Matrix Video** (新增) | `MATRIX_FRAME` | 完整 3x3 母图作为参考 | `generatedImageUrl` (完整母图) | 动态分镜 (Animatic)、一致性样片 |
| **Asset Video** (预埋) | `ASSET_COLLAGE` | 资产拼贴图作为参考 | 动态合成的 Collage Buffer | 强角色/场景一致性生成 |
| **Text Only** (预留) | `TEXT_ONLY` | 纯 Prompt | 无图片 | 创意探索 |

### 2.2 功能入口规划

1.  **Slot Video (保持现状)**:
    *   入口：点击矩阵中的单格 -> 视频生成弹窗。
    *   逻辑：默认使用 `IMAGE_FIRST_FRAME` 模式。
    *   *Step 2 任务*: 代码解耦，确保后端接口支持 `inputMode` 参数。

2.  **Matrix Video (本次新增)**:
    *   入口：矩阵编辑器顶部工具栏 -> "生成动态分镜 (Animatic)" 按钮。
    *   逻辑：
        *   **Input**: 3x3 完整母图。
        *   **Prompt**: 自动拼接 9 个机位的 Prompt + 预设的“运镜逻辑模板” (Freeze Frame / Camera Move)。
    *   *Step 2 任务*: 实现 UI 入口、Prompt 拼接逻辑、后端调用链路。

3.  **Asset Video (技术预研/Step 2.5)**:
    *   逻辑：Main 进程需引入图像处理库 (`sharp`)，支持将 `Character + Scene + Prop` 拼贴为一张参考图。
    *   *Step 2 任务*: 仅预留接口枚举，暂不实现具体图像处理逻辑 (除非进度超前)。

### 2.3 文本一致性 (原 Step 2 核心)

保持原计划，继续完善：
*   **Prompt 注入**: `[Character: ...]`, `[Environment: ...]`。
*   **强制校验**: `generateGridImage` 前检查 `shot.characterIds` / `shot.sceneIds`。
*   **ShotKind**: 支持 `ENV` 豁免角色绑定。

---

## 3. 详细任务拆解 (How)

### 3.1 Shared Types (`src/shared/types.ts`)

```typescript
// 新增视频输入类型枚举
export type VideoInputMode = 'TEXT_ONLY' | 'IMAGE_FIRST_FRAME' | 'IMAGE_FIRST_LAST' | 'MATRIX_FRAME' | 'ASSET_COLLAGE';

// 扩展 Shot 或相关接口 (待定，或作为生成参数传递)
export interface VideoGenerationParams {
  shotId: string;
  angleIndex?: number; // 0-8, 仅 Slot Video 需要
  inputMode: VideoInputMode;
  // ... 其他覆盖参数
}
```

### 3.2 Main Process (`src/main/`)

1.  **`providers/aihubmix/gemini.ts` (及相关服务)**:
    *   修改 `generateVideo` (或新建适配器)，接受 `inputMode`。
    *   实现 `MatrixPromptBuilder`:
        ```typescript
        function buildMatrixVideoPrompt(shot: Shot, config: GlobalConfig): string {
          // 1. 拼接 9 机位 Prompt
          // 2. 注入 "Based on 3x3 grid..." 头部约束
          // 3. 注入 Style & Asset description
          return finalPrompt;
        }
        ```

2.  **`ipc.ts`**:
    *   更新 `IPC_CHANNELS.ai.generateVideo` 处理逻辑，根据参数分发。

3.  **Consistency Logic**:
    *   确保文本注入逻辑 (已由 C 队部分实现) 覆盖所有 Prompt 生成路径。

### 3.3 Renderer Process (`src/renderer/`)

1.  **`MatrixPromptEditor.tsx`**:
    *   **顶部栏**: 新增 "Generate Animatic" 按钮 (当母图存在时激活)。
    *   **Slot 弹窗**: 内部逻辑重构，明确传递 `inputMode: 'IMAGE_FIRST_FRAME'`。
    *   **胶囊显示**: 继续完善 "已注入资产" 的 UI 反馈。

2.  **`services/geminiService.ts`**:
    *   更新前端 API 调用签名。

---

## 4. 执行计划 (Execution)

1.  **C 队 (Current)**: 暂停编码，等待本方案确认。
2.  **合并**: 建议先合并 `feat/phase4-step1-control`。
3.  **分支**: 基于 main (含 Step 1) 创建新的 `feat/phase4-step2-revised` (或重置旧分支)。
4.  **开发顺序**:
    *   T1: Shared Types 定义 & IPC 接口重构。
    *   T2: Main 端 `MatrixPromptBuilder` & 文本注入完善。
    *   T3: Renderer 端 "Animatic" 入口 & Slot 视频适配。
    *   T4: 验证 (Smoke Test)。

## 5. 待确认问题 (Open Questions)

*   **Q1**: Matrix Video 生成后的视频 URL 存在哪里？
    *   *建议*: `Shot.videoUrls` 仅存 9 个格子的视频。Matrix Video 属于 Shot 级别的衍生品，建议新增 `Shot.animaticVideoUrl` 字段。
*   **Q2**: 现有 `sora-2` 模型对 3x3 图片的接受度？
    *   *假设*: 已由用户验证可行。我们将母图作为 Image Input 传入。

---
**批准人**: XucroYuri (需方), G 队 (Aux)