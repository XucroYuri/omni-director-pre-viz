---
status: ARCHIVED
---

# Omni-Director Pre-viz 开发方案 (Proposal by Gemini3pro)

> 历史文档说明：本文件仅用于历史方案追溯，当前实施入口为 `rules.md` 与 `docs/*`。

**项目名称**: 全覆盖·智能影视预演工作站 (Omni-Director Pre-viz Workstation)  
**版本**: V4.0 (Refined)  
**文档日期**: 2025-12-20  
**作者**: Gemini3pro Agent

---

## 1. 方案核心差异与价值主张

本方案 (`Plan-Gemini3pro`) 与之前的实现方案相比，核心差异在于**严格回归原始需求逻辑**，特别是纠正了图像生成策略和 API 适配逻辑，旨在降低成本、提高生成一致性，并增强系统的工程健壮性。

| 维度 | 现有原型 (Legacy) | **Gemini3pro 方案 (New)** | 收益 |
| :--- | :--- | :--- | :--- |
| **生成策略** | 9 次 API 调用生成 9 张图 | **1 次 API 调用生成 1 张 3x3 母图 + 物理切割** | 成本降低 89%，光影/风格一致性大幅提升 |
| **API 服务** | 强依赖 Google AI Studio | **优先 aihubmix.com，兼容 Google AI Studio** | 适应新的服务商要求，具备容灾能力 |
| **视频生成** | 仅支持生成的图片转视频 | **任意图片 (母图/子图) 均可转视频** | 灵活性更强，支持从宏观到微观的动态预演 |
| **数据流** | Base64 存 LocalStorage (易崩) | **IndexedDB 存 Blob + 自动备份** | 工业级稳定性，支持 GB 级项目 |
| **架构模式** | 巨型组件 (God Component) | **微服务化/原子组件/Hooks** | 易维护，易测试，多人协作友好 |

---

## 2. 详细系统架构与模块分解

### 2.1 核心流程 (The Pipeline)

```mermaid
graph TD
    A[用户输入剧本] --> B(LLM: 剧本清洗与时序拆解);
    B --> C[镜头列表 (Chronological Shot List)];
    C --> D{用户配置资产/风格};
    D --> E(LLM: 矩阵 Prompt 工程);
    E --> F[9机位 Prompt 预览 (3x3)];
    F --> G{用户确认/修改};
    G --> H(Image Gen: 生成 3x3 母图);
    H --> I(Code: 物理切割为 9 张子图);
    I --> J[矩阵结果展示];
    J --> K{单张重绘 / 视频生成};
```

### 2.2 模块详细设计

#### 模块 A: 剧本处理引擎 (Narrative Engine)
*   **输入**: 长文本剧本 (Script)。
*   **处理**:
    1.  **Global Context Agent**: 提取世界观、氛围。
    2.  **Segmentation Agent (Beat/Scene)**:
        *   **逻辑**: 采用 **Beat (节拍) 为主，Scene (场景) 为辅** 的混合拆分策略。
        *   **Scene**: 基于空间变换（INT./EXT.）进行物理切割。
        *   **Beat**: 在 Scene 内部基于剧情语义（情绪转折、动作发生）进行细粒度拆分，解决单场景长对话无法拆解的问题。
    3.  **Breakdown Agent**: 将 Beat 转化为具体的 **Shot (叙事镜头)**，保留原文锚点。
*   **输出**: `ScriptBreakdown` 对象，包含 `Beats` 和 `Shots` 的多对多映射。

#### 模块 B: 资产管理系统 (Asset Manager)
*   **分层架构 (Hierarchy)**:
    *   **Level 1: IP (Concept)**: 抽象概念集合（如“漫威宇宙”）。
    *   **Level 2: Project (World)**: 具体影视项目（如“钢铁侠”）。
    *   **Level 3: Season (Assets)**: 资产共享层（如“第一季”）。
    *   **Level 4: Episode (Entity)**: 作业实体层。
    *   **Level 5: Shot (Narrative)**: 最小叙事单元。
    *   **Level 6: Angle (Production)**: 制作冗余层（9机位）。
*   **存储**: 使用 `IndexedDB` 存储参考图 (Blob)。
*   **注入逻辑**:
    *   **Style**: 自动继承 `Project/Season` 层级定义的全局 Style。
    *   **Character/Scene**: 优先从 `Season` 库中读取。
    *   **兜底策略**: 若 Asset 无参考图，自动降级为注入 `description` 字段中的详细文本特征。
*   **关联模型**:
    *   Video 表新增字段 `source_image_id` (关联母图/子图 ID) 和 `related_shot_id` (关联镜头 ID)。

#### 模块 C: 矩阵提示词编辑器 (Matrix Editor)
*   **核心逻辑**:
    *   针对每个 Shot，调用 LLM 生成 9 段 Prompt。
    *   结构：`[机位 EST] + [中文视觉] + [英文术语] + [Style] + [Trigger Words]`。
    *   **解耦**: Prompt 生成与图像生成完全分离。用户可以只改 Prompt 不生图。

#### 模块 D: 生成控制中心 (Generation Hub)
*   **任务队列 (Task Queue)**:
    *   **限制**: 全局并发不超过 2 个任务 (防止 API Rate Limit)。
    *   **执行参数表 (Execution Specs)**:
        | 参数 | 值 | 说明 |
        | :--- | :--- | :--- |
        | Max Retries | 3 | 指数退避 (1s, 2s, 4s) |
        | Timeout (Img) | 60s | 图片生成超时阈值 |
        | Timeout (Vid) | 300s | 视频生成超时阈值 |
        | Polling Interval | 5s | 视频生成轮询间隔 |
    *   **类型**: `MatrixJob` (生成母图), `RefineJob` (单图重绘), `VideoJob` (视频生成)。
*   **生成策略 (Critical)**:
    *   **MatrixJob**:
        *   拼合 9 段 Prompt 为一段复合 Prompt (Composite Prompt)。
        *   调用 `gemini-3-pro-image-preview` 生成 1 张图。
        *   Canvas API 切割为 9 张 `Blob` (即 9 个 Angle)。
        *   命名规范: `{EpisodeID}_{SceneID}_{ShotID}_{AngleCode}_{01-09}.png`。
*   **API 适配器**:
    *   `AiHubMixAdapter`: Base URL `https://aihubmix.com/gemini`, Key `AIHUBMIX_API_KEY`。
    *   `GoogleAdapter`: Base URL 默认, Key `GEMINI_API_KEY`。

#### 模块 E: 交付与交互 (Delivery UI)
*   **视图**: 瀑布流 (Timeline) + 灯箱 (Lightbox)。
*   **视频生成**:
    *   入口：任意子图/母图右下角 "Magic Video" 按钮。
    *   逻辑：Image + Text Prompt -> Veo Model -> Video URL。
*   **导出**:
    *   ZIP 打包：包含 JSON 元数据 + 规范命名的图片文件。
*   **数据迁移**:
    *   启动时检测 `localStorage` 中的旧版 Base64 数据，后台静默迁移至 `IndexedDB`，完成后清空 `localStorage` 对应字段。

---

## 3. API 适配方案 (AiHubMix Integration)

根据需求，我们将实现一个统一的 `GeminiClient` 工厂，自动处理服务商切换。

### 3.1 配置逻辑
优先读取 `AIHUBMIX_API_KEY`。如果存在，则配置 `base_url` 为 `https://aihubmix.com/gemini`。否则，回退到标准 Google 配置。

### 3.2 代码伪逻辑 (TypeScript)

```typescript
// services/geminiClient.ts

import { GoogleGenAI } from "@google/genai";

interface ClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export const getGeminiClient = (): GoogleGenAI => {
  const aihubKey = localStorage.getItem("AIHUBMIX_API_KEY") || import.meta.env.VITE_AIHUBMIX_API_KEY;
  const googleKey = localStorage.getItem("GEMINI_API_KEY") || import.meta.env.VITE_GEMINI_API_KEY;

  let config: ClientConfig;

  if (aihubKey) {
    console.log("Using AiHubMix Provider");
    config = {
      apiKey: aihubKey,
      baseUrl: "https://aihubmix.com/gemini" // 注意：SDK 可能需要特定的 transport 配置来支持 base_url
    };
    // 注意：Google官方SDK对base_url的支持可能有限，需检查 http_options
    // 如果 SDK 不支持直接改 base_url，可能需要自定义 fetch 实现或使用兼容的 OpenAI SDK 模式（如果接口兼容）
    // 根据需求描述，python示例使用了 http_options={"base_url": ...}，Node SDK 需查阅文档确认对应字段
  } else if (googleKey) {
    console.log("Using Google Official Provider");
    config = { apiKey: googleKey };
  } else {
    throw new Error("No API Key found. Please configure AIHUBMIX_API_KEY or GEMINI_API_KEY.");
  }

  return new GoogleGenAI(config.apiKey, {
     // 假设 SDK 支持此配置，需验证
     transport: {
        baseUrl: config.baseUrl
     }
  });
};
```

---

## 4. 任务分解 (Task Breakdown)

### Phase 1: 基础设施重构 (Infrastructure)
*   [ ] **T1.1**: 创建 `services/api` 目录，封装 `GeminiClient`，实现多 Provider 切换逻辑。
*   [ ] **T1.2**: 引入 `idb` 库，建立 `IndexedDB` 结构 (`projects`, `shots`, `assets`, `images`)。
*   [ ] **T1.3**: 实现 `hooks/useTaskQueue`，管理并发任务状态。

### Phase 2: 剧本与 Prompt 模块 (Script & Prompt)
*   [ ] **T2.1**: 重构 `breakdownScript`，确保原文锚点保留，优化 System Prompt。
*   [ ] **T2.2**: 实现 `MatrixPromptEditor` 的解耦逻辑（仅生成文本，不生成图）。
*   [ ] **T2.3**: 实现 Prompt 拼合逻辑（9 合 1）。

### Phase 3: 图像生成与处理 (Image Generation)
*   [ ] **T3.1**: 实现 `generateGridImage` (调用 aihubmix 接口)。
*   [ ] **T3.2**: 实现 `splitGridImage` (Canvas 物理切割)。
*   [ ] **T3.3**: 实现图片 Blob 入库 `IndexedDB`。

### Phase 4: 视频与交付 (Video & Delivery)
*   [ ] **T4.1**: 集成 Veo 视频生成接口。
*   [ ] **T4.2**: 实现 ZIP 打包下载功能。
*   [ ] **T4.3**: 完善 UI/UX（加载状态、错误提示、离线回退）。

---

## 5. 开发注意事项

1.  **网格切割精度**: 由于 AI 生成的网格可能存在微小的像素偏差，建议在 Prompt 中强制要求 "exact 3x3 grid, white borders"，并在切割代码中做边缘容错处理。
2.  **Prompt 长度**: 9 段 Prompt 拼合后可能超长，需注意 Token 限制。必要时对单段 Prompt 进行精简。
3.  **错误处理**: `aihubmix` 可能会有不同的错误码，需在 `services/api` 层统一映射为应用内部错误码。

---

**Next Step**: 按照 `Phase 1` 开始搭建基础服务。
