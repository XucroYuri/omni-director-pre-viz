---
status: ARCHIVED
---

# Plan-FullStack-BFF: 高性能安全前后端分离架构方案

> 历史文档说明：本文件仅用于历史方案追溯，当前实施入口为 `rules.md` 与 `docs/*`。

**版本**: V1.0 (BFF Architecture)
**日期**: 2025-12-20
**作者**: Gemini3pro (Full-Stack Engineer)

---

## 1. 核心架构演进：引入 Node.js BFF 层

为了满足高性能、高安全性及前端零信任的需求，我们将从“纯前端 SPA + 直接调用第三方 API”模式，升级为 **“React 前端 + Node.js BFF (Backend for Frontend) + 第三方 API”** 的经典前后端分离架构。

### 1.1 架构图 (Architecture Overview)

```mermaid
graph TD
    User[用户浏览器] -- HTTPS/WSS --> BFF[Node.js BFF Cluster];
    BFF -- gRPC/HTTP --> Auth[鉴权中心];
    BFF -- Queue --> TaskWorker[任务调度 Worker];
    TaskWorker -- API Key (Secret) --> LLM[Google/AiHubMix LLM];
    TaskWorker -- API Key (Secret) --> ImgGen[Image Generation API];
    TaskWorker -- Signed URL --> VideoGen[Veo Video API];
    BFF -- Stream --> OSS[对象存储 (S3/GCS)];
    BFF -- ORM --> DB[PostgreSQL/Mongo (元数据)];
    
    subgraph DataModel [影视工业化分层模型]
      IP[IP (概念层)] --> Project[Project (世界观层)];
      Project --> Season[Season (资产共用层)];
      Season --> Episode[Episode (实体作业层)];
      
      subgraph EpisodeFlow [剧本细化拆解]
        Episode --> Script[Script (剧本原文)];
        Script --> BeatScene[Beat (剧情节拍) + Scene (空间场景)];
        BeatScene -- 多对多 --> Shot[Shot (叙事镜头)];
        Shot --> Angle[Angle (制作机位)];
      end
    end
```

### 1.2 核心价值

1.  **前端安全 (Frontend Security)**:
    *   **零密钥暴露**: 浏览器端完全不接触 `API_KEY`。所有第三方 API 调用由 BFF 代理，密钥仅存在于服务器环境变量中。
    *   **Signed URL**: 视频/图片下载链接由 BFF 生成短效签名 URL，防止链接被盗链或恶意传播。

2.  **高性能 (High Performance)**:
    *   **流式转发 (Stream Proxy)**: BFF 对大文件（生成的 4K 图、视频）采用流式转发，不占用服务器内存，直接 piping 到客户端或对象存储。
    *   **边缘缓存 (Edge Caching)**: 利用 CDN 缓存静态资源和公共资产（如通用风格参考图）。

3.  **API 聚合 (API Aggregation)**:
    *   **GraphQL / tRPC**: 前端通过一个请求获取“剧本拆解 + 资产推荐 + 风格配置”，减少网络往返 (RTT)。

---

## 2. 前端重构思路 (Frontend Refactoring)

作为前端见长的全栈工程师，我建议前端应用做以下调整：

### 2.1 API 调用层改造
*   **移除**: 所有直接调用 `google-genai` SDK 的代码。
*   **新增**: `BFFClient` (基于 tRPC 或 Axios)。
*   **接口示例**:
    ```typescript
    // 旧模式
    // const genAI = new GoogleGenAI(process.env.API_KEY);
    
    // 新模式 (tRPC)
    const result = await trpc.shot.generateMatrix.mutate({ 
      shotId: 's1', 
      prompts: [...] 
    }); 
    // result 仅返回 taskId，不直接返回图片
    ```

### 2.2 状态管理与轮询
*   由于生成任务异步化，前端需实现稳健的 **WebSocket** 或 **SSE (Server-Sent Events)** 监听。
*   **Store**: 使用 `Zustand` 维护 `taskMap`，实时更新任务进度 (Progress %) 和状态 (Queued/Processing/Done)。

### 2.3 本地与云端混合存储
*   **策略**: 小数据（配置、临时编辑）存 IndexedDB；大数据（母图、视频）存云端 OSS。
*   **同步**: 实现 `SyncEngine`，在网络空闲时将 IndexedDB 的离线操作队列同步到 BFF。

---

## 3. 需要后端团队配合点 (Collaboration Requirements)

为了实现上述架构，我们需要后端团队（或 BFF 开发角色）提供以下支持：

### 3.1 基础设施 (Infra)
1.  **BFF 服务搭建**: 建议使用 **NestJS** (企业级) 或 **Hono** (高性能 Edge 适配)。
2.  **任务队列**: 部署 **Redis** + **BullMQ**，用于管理并发生成任务（限制并发数，支持优先级插队）。
3.  **对象存储**: 提供兼容 S3 的 OSS Bucket，并配置 CORS 和生命周期规则（如临时文件 24h 过期）。

### 3.2 接口定义 (API Contract)
我们需要共同定义 `.proto` 或 `OpenAPI (Swagger)` 文档，核心接口包括：

*   `POST /api/v1/auth/login`: 换取 HttpOnly Cookie (JWT)。
*   `POST /api/v1/script/breakdown`: 提交剧本，返回 `jobId`。
*   `POST /api/v1/matrix/generate`: 提交 Prompt 矩阵，返回 `jobId`。
*   `GET /api/v1/tasks/:id/sse`: 任务进度实时推送流。
*   `POST /api/v1/assets/upload`: 获取预签名上传 URL (Presigned URL)，前端直传 OSS。

### 3.3 安全策略 (Security Policy)
1.  **Rate Limiting**: 针对每个 User ID 限制生成接口调用频率（如 10 次/分钟）。
2.  **WAF**: 配置防火墙拦截恶意 Prompt 注入（BFF 层需做一层 Prompt Cleaning）。

---

## 4. 开发任务分解 (Full-Stack Tasks)

### Phase 1: BFF 脚手架与鉴权 (3 Days)
*   [FE] 移除前端 API Key 逻辑，封装 `AuthService`。
*   [BE] 搭建 NestJS + Redis 基础环境，实现 JWT 鉴权与 HttpOnly Cookie 注入。

### Phase 2: 异步任务队列系统 (5 Days)
*   [BE] 实现 BullMQ 队列，集成 Google/AiHubMix SDK，实现重试与超时机制。
*   [FE] 实现 `useTaskSubscription` Hook，基于 SSE 实时更新 UI 进度条。

### Phase 3: 资产与 OSS 对接 (4 Days)
*   [BE] 实现 OSS 预签名接口，配置 bucket 策略。
*   [FE] 实现大文件分片直传 OSS 组件，支持断点续传。

### Phase 4: 兜底与容灾 (3 Days)
*   [BE] 实现 Provider 自动切换逻辑 (AiHubMix -> Google)。
*   [FE] 实现离线模式 (Offline Mode)，断网时只读访问 IndexedDB 缓存。

---

**总结**: 
通过引入 BFF 层，我们将“重计算、重密钥”的逻辑移至可控的服务器端，前端回归“轻量级、重交互”的本质。这不仅彻底解决了安全隐患，还利用服务器的并发处理能力大幅提升了批量生成的效率。
