# 全面技术评审与解决方案文档 (Technical Review)

**日期**: 2025-12-20  
**项目**: Omni Director Pre-viz  
**版本**: v0.0.0 (Pre-Alpha)

---

## 0. 核心结论 (面向决策层)
- API Key 暴露与调用路径缺乏安全层：前端直读 `process.env.API_KEY` 且在视频下载时拼接到 URL (`services/geminiService.ts:269`)，存在密钥泄漏与滥用风险。
- 资产/镜头链接链路未落地：Shot 的 `characterIds/sceneIds/propIds` 从未更新，`AssetBubble` 的链接/解绑函数是空实现，导致生成上下文缺失，输出质量与一致性都难以保证。
- 数据存储不可扩展：母图、九宫格切片、Ref 图片均以 Base64 写入 `localStorage` (`App.tsx:18-40` 及子状态)，极易超 5MB 配额并造成页面不可恢复的加载错误。
- 队列/长任务管理缺失：生成 4K 图和 Veo 视频无并发/排队保护，也没有超时与错误分类，用户无法判断任务状态。
- 架构与可扩展性：服务层强耦合 Google GenAI，缺少接口抽象；`App` 为上帝组件，状态与副作用交织，增加维护成本。

---

## 1. 产品经理视角
### 1.1 关键问题与用户影响
- **密钥暴露与配额风险** (`services/geminiService.ts:17, 260-279`): 前端直接拿环境变量且把 key 带在下载 URL 中，用户若分享链接即可泄漏配额；也缺少 key 选择与失效处理。
- **体验断点：生成前置校验缺失** (`App.tsx:44-121`): 允许空/不足 9 条的 Prompt 直接发图，导致生成失败或成本浪费；错误提示不指向具体机位。
- **资产联动缺位** (`MatrixPromptEditor.tsx:141-194`): 自动发现的资产只加入库，不绑定镜头；镜头上下文始终为空，AI 输出与用户预期偏离。
- **存储与项目管理缺失** (`App.tsx:18-40`): 单项目、单存储，清缓存或超配额即丢失；不支持多项目/导入导出高保真。
- **反馈不足** (`MatrixPromptEditor.tsx:197-246`): 视频生成只有“Processing”，无剩余时间/进度，用户无法决策是否等待。

### 1.2 待澄清问题
1) 目标运行模式：完全浏览器端 + AI Studio Key，还是需服务端代理？  
2) 多项目/协作需求：是否需要项目切换、版本管理与云存储？  
3) 成本控制策略：单镜头的最大重试次数与分辨率上限是否需要产品层限制？  
4) 视频超时体验：Veo 生成超过多长时间要提示或降级？

### 1.3 产品向改进建议
- 增加“生成前校验清单”：9/9 Prompt 就绪、至少 1 角色 + 1 场景已绑定、分辨率/长宽比合法才允许渲染。
- 引入“任务中心/队列”：显示排队、处理中、失败原因；支持取消和重试。
- 资产智能联动：自动推荐资产后，提供“一键绑定”+“查看差异”提示，确保上下文闭环。
- 项目管理：支持多项目保存、下载/导入 .json，重加载时校验缺失的 Blob 资源。

---

## 2. 架构师视角
### 2.1 安全与密钥治理
- 问题：前端直持密钥且下载视频时附加 key 参数 (`services/geminiService.ts:269`)。  
- 方案：前后端分层。前端通过 AI Studio 的 key picker 或后端 token 交换；视频下载改为后端代理/签名 URL。去掉对 `process.env` 的直接读取，改用 `import.meta.env` + 运行时注入。

### 2.2 存储与数据模型
- 问题：Base64 图片、切片和历史版本全写 `localStorage` (`App.tsx` 持久化 `breakdown`)，高概率超限。  
- 方案：用 IndexedDB (idb) 存 Blob；`localStorage` 仅存 metadata、指针与轻量配置。历史记录只存引用，不重复存母图。

### 2.3 任务与并发控制
- 问题：无队列/无节流，4K 图和视频可被多次点击触发；视频轮询使用 `ai.operations.getVideosOperation({ operation })` 可能不符合 SDK 的 `name` 字段要求，存在永不结束风险。  
- 方案：引入任务队列 (单窗口串行或 N 并行)，为图/视频增加超时、最大重试、错误分类（鉴权/配额/内容/未知）。轮询需校验返回 schema 并在 UI 显示剩余重试/超时。

### 2.4 模块与依赖抽象
- 问题：Service 强耦合 Google 模型常量 (`constants.ts:6-35`)。  
- 方案：定义 `LLMProvider`, `ImageProvider`, `VideoProvider` 接口，使用适配器模式；将系统提示词与 schema 分离为配置文件，方便 A/B 与多模型切换。

### 2.5 状态架构
- 问题：`App` 过载；`Sidebar`/`MatrixPromptEditor` 接收巨大 props，频繁重渲染。  
- 方案：用 Zustand/Context 拆分 `project`, `assets`, `tasks`; 将副作用封装到 hooks (`usePromptMatrix`, `useMediaTasks`) 并用 selector 减少重渲染。

---

## 3. 前端专家视角
### 3.1 性能与可维护性
- **嵌套组件导致重挂载**：`AssetCard` 定义在 `Sidebar` 内部 (`Sidebar.tsx:140-232`)，每次 render 都重新创建，DOM 反复卸载/挂载。应移出文件或用 `React.memo`.
- **长列表无虚拟化**：分镜列表与资产列表在 50+ 条时会卡顿。建议 `react-window/react-virtuoso`。
- **大图片上传缺乏限制**：`handleFileUpload` 未校验文件大小/类型 (`Sidebar.tsx:113-144`)，可能导致主线程阻塞。应压缩 + 尺寸限制。

### 3.2 可用性
- 缺少链接操作：`AssetBubble` 的 `onUnlink` 为空 (`MatrixPromptEditor.tsx:155-191`)，无法解绑；无批量绑定/解绑入口。
- 历史恢复不完整：恢复只还原母图与 Prompt，不恢复视频 URL/状态 (`App.tsx:70-107`)，导致历史视图不一致。

### 3.3 可测试性
- 零单测：核心 `safeJsonParse`、LLM schema 解析无保护。应引入 Vitest + RTL，mock LLM 输出，校验异常路径。

### 3.4 文案与多语言
- 文案硬编码：机位名称、按钮文案分散在组件内 (`MatrixPromptEditor.tsx:38-45` 等)。建议集中到 `constants/uiText.ts` 或 i18n 资源。

---

## 4. 重点风险清单 (按优先级)
| 优先级 | 领域 | 问题 | 参考位置 | 建议 |
| --- | --- | --- | --- | --- |
| P0 | 安全 | API Key 暴露与 URL 透传 | services/geminiService.ts:17, 260-279 | 改为后端代理/AI Studio Key picker；移除 key 直传 |
| P0 | 数据 | Base64 大图写 localStorage | App.tsx:18-40; types.ts | 迁移 IndexedDB/Blob URL，LS 存指针 |
| P0 | 质量 | 镜头资产未绑定，Prompt 生成上下文为空 | MatrixPromptEditor.tsx:141-194; services/getShotAssetContext | 实现绑定/解绑与自动推荐落地，生成前校验 |
| P1 | 任务 | 图/视频无队列与超时；轮询 API 可能不合法 | services/geminiService.ts:240-279 | 引入任务队列、超时、错误分类；修正轮询入参 |
| P1 | 架构 | God Component + Props Drilling | App.tsx; Sidebar.tsx | 引入 Zustand/Context + hooks 拆解 |
| P2 | 性能 | 列表未虚拟化；AssetCard 内联定义 | Sidebar.tsx | 提取组件 + 虚拟滚动 |
| P2 | 体验 | 生成状态缺乏进度与失败定位 | MatrixPromptEditor.tsx | 任务中心 + 机位级错误提示 |
| P3 | 规范 | 文案硬编码、无 i18n | 多处 | 提取文案/国际化 |

---

## 5. 技术解决方案蓝图 (开发可执行)
1) **密钥与调用链改造**
   - 前端：使用 `window.aistudio` 选择 key；不再读取 `process.env`；从 URL 移除 key 参数。
   - 后端/代理（如有）：提供签名/短期 token，用于图片/视频下载；统一错误码（鉴权/配额/内容/未知）。
2) **存储分层**
   - IndexedDB 存 Blob（母图、切片、ref 图、视频）；`localStorage` 只存项目元数据、指针、轻量配置。
   - 历史记录存引用，不重复存 Blob；提供“清理缓存”入口。
3) **资产-镜头闭环**
   - Shot 结构强制包含 `characterIds/sceneIds/propIds`；在生成前校验。
   - 自动推荐后提供“一键绑定/全部跳过”；支持批量解绑/替换。
4) **任务与并发管理**
   - 全局任务队列（最多 1-2 并发生成）；显式状态：排队/生成/重试/失败。
   - 图/视频生成加超时与最大重试；轮询使用 operation.name，超过阈值提示降级。
5) **性能与可维护性**
   - 抽出 `AssetCard`，加 `React.memo`；列表改虚拟化。
   - 上传前做体积与分辨率校验，必要时用 Web Worker 压缩。
6) **测试与监控**
   - 引入 Vitest + RTL；覆盖 `safeJsonParse`、LLM schema 解析、任务队列状态机。
   - 集成 Sentry/Analytics；记录生成成功率、耗时、失败原因分布。

---

## 6. 待决策/开放问题
- 是否提供服务端代理以避免密钥泄漏，并支持配额/速率限制？
- 项目是否需要多人/云端协作（影响存储与权限设计）？
- 成本上限与降级策略（分辨率、重试次数、并发上限）如何设定？
- Veo 生成的最长等待时间和超时回退策略是否需要产品层提示？

---

## 7. 建议的近期冲刺拆解 (示例)
1) 安全与存储：移除前端直传 key，改代理；落地 IndexedDB + 指针持久化（P0）。
2) 生成闭环：资产绑定落地 + 生成前校验 + 任务队列与超时（P0/P1）。
3) 性能与可用性：虚拟滚动、组件拆分、上传限制、进度提示（P2）。
4) 工程质量：Vitest 基线用例、Sentry/Analytics 接入、文案集中化（P2/P3）。

---

## 8. 开发行动方案（详细执行版 - 工业级规范增强）

### 8.1 安全与密钥治理 (Security & Governance)
- **目标**：构建零信任前端调用链，避免密钥泄漏并符合基础合规要求。
- **动作**：
  1.  **鉴权层改造**：接入 AI Studio Key Picker 或 OAuth2.0 流程；彻底移除 `process.env.API_KEY` 及代码硬编码；Veo 视频下载链接移除 query param 中的 key，改用短效签名 URL (Signed URL)。
  2.  **内容安全策略 (CSP)**：配置严格的 CSP 头，限制 `script-src` 和 `connect-src`，防止 XSS 和数据外泄；建立 CDN 白名单联动机制（如 Tailwind, importmap），避免误伤。
  3.  **输入清洗**：引入 `dompurify` 对所有用户输入（剧本、Prompt）进行清洗；使用 `zod` 对 LLM 返回的 JSON 进行运行时 Schema 校验，防止结构化注入。
- **交付物**：`services/auth/AuthManager.ts`，CSP 配置文档，Zod Schema 定义集。

### 8.2 存储与数据模型 (Storage & Data Architecture)
- **目标**：在浏览器配额内（≥200MB，期望 500MB）安全持久化大文件，并具备事务与迁移能力。
- **动作**：
  1.  **IndexedDB 封装**：使用 `dexie.js` 或 `idb` 构建 ORM 层；设计多表结构：`projects`, `assets`, `shots`, `media_blobs`。
  2.  **Schema Versioning**：实现数据库版本管理与迁移脚本 (Migration Scripts)，确保软件升级后旧数据不丢失、不损坏。
  3.  **大文件流式处理**：图片/视频上传与读取采用 Stream API，避免一次性加载整个 Blob 到内存；使用 `StorageManager.estimate()` 实施配额监控与前置告警。
  4.  **自动备份与回退**：实现后台静默导出 JSON+指针快照；File System Access API 可用时直接写入，否则提供降级方案（如定期提示下载 ZIP 归档）。
- **交付物**：`storage/db.ts` (Database Layer), `storage/migrations/`, `hooks/useProjectAutoSave.ts`。

### 8.3 资产-镜头闭环与生成前校验 (Business Logic Integrity)
- **目标**：确保业务逻辑闭环，拒绝非法状态流转。
- **动作**：
  1.  **领域驱动设计 (DDD)**：定义 `Shot` 为聚合根，`Asset` 为实体；实现 `ShotService.bindAsset(shotId, assetId)` 领域服务，确保双向引用一致性。
  2.  **生成前置守卫 (Guard Clauses)**：实现 `GenerationPolicy` 类，校验规则：`hasValidPrompts`, `hasLinkedAssets`, `isResolutionCompliant`。不满足抛出结构化错误 `PolicyViolationError`。
  3.  **资产血缘追踪**：记录资产来源（上传/AI 生成/库引用），在 Prompt 优化时根据来源注入不同的 Context 权重。
- **交付物**：`domain/shot/ShotService.ts`, `domain/policy/GenerationPolicy.ts`。

### 8.4 任务队列与长任务治理 (Concurrency & Async Job Management)
- **目标**：实现可观测、可恢复、公平调度的任务系统。
- **动作**：
  1.  **持久化任务队列**：将任务状态写入 IndexedDB。页面刷新后，`TaskRunner` 读取未完成任务并尝试恢复或标记为失败（Resumability）。
  2.  **并发控制与限流**：实现 `TokenBucket` 算法限制 API 调用频率；区分 `InteractivePriority` (即时生成) 和 `BackgroundPriority` (批量导出)；强制所有生成类 API 调用（LLM/Image/Video）通过全局队列调度。
  3.  **断路器模式 (Circuit Breaker)**：当连续 N 次 API 错误时，自动暂停队列并降级 UI，避免雪崩效应。
- **交付物**：`services/queue/TaskQueue.ts`, `services/queue/CircuitBreaker.ts`。

### 8.5 性能与可维护性 (Performance & Maintainability)
- **目标**：维持 60fps 帧率，LCP < 2.5s，FID < 100ms。
- **动作**：
  1.  **组件重构**：将 `AssetCard` 移出并使用 `React.memo`；实现 `VirtualList` 渲染侧边栏。
  2.  **Web Worker 卸载**：将图片压缩、Base64 转换、大文本解析等计算密集型任务移至 Worker 线程 (`comlink` 或原生 Worker)。
  3.  **按需加载 (Code Splitting)**：对 `MatrixPromptEditor`、`Settings` 等非首屏组件进行 Lazy Load。
- **交付物**：`workers/imageProcessor.worker.ts`, 组件拆分 PR。

### 8.6 测试与监控 (QA & Observability)
- **目标**：测试覆盖率 > 80%，关键路径自动化，线上问题 100% 可追溯。
- **动作**：
  1.  **分层测试策略**：
      - Unit Test (Vitest): 覆盖 Utils, Parsers, Hooks。
      - Integration Test (RTL): 覆盖组件交互与 Context 数据流。
      - E2E Test (Playwright): 覆盖“新建项目 -> 导入剧本 -> 生成分镜 -> 导出视频”完整链路。
  2.  **结构化日志**：引入 `pino` 或自定义 `Logger`，记录 `{ level, module, action, meta }`，而非简单的 `console.log`。
  3.  **全链路监控**：集成 Sentry 捕获 Crash；集成 PostHog/Mixpanel 分析用户行为；上报 Web Vitals 指标。
- **交付物**：`tests/e2e/`, `utils/logger.ts`, Sentry 配置。

### 8.7 工程化规范 (Engineering Standards) - *新增*
- **目标**：统一代码风格，杜绝低级错误，提升协作效率。
- **动作**：
  1.  **Strict TypeScript**：`tsconfig.json` 开启 `strict: true`, `noImplicitAny: true`。
  2.  **Git Hooks**：配置 Husky + Lint-staged，提交前强制执行 `eslint --fix`, `prettier`, `tsc --noEmit`。
  3.  **提交规范**：遵循 Conventional Commits (`feat:`, `fix:`, `chore:`)，配合 Commitlint。
  4.  **依赖锁定**：强制使用 `.npmrc` 锁定引擎版本，确保开发环境一致。

### 8.8 错误边界与灾难恢复 (Resilience) - *新增*
- **目标**：系统级容错，确保“不白屏，不丢数据”。
- **动作**：
  1.  **React Error Boundaries**：在 `Sidebar`, `Editor`, `Preview` 等主要区域包裹 Error Boundary，捕获渲染错误并提供“重试组件”按钮。
  2.  **安全模式 (Safe Mode)**：检测到连续 Crash 时，提示用户进入安全模式（禁用部分高级特效或插件，重置本地配置）。
  3.  **离线可用 (PWA)**：配置 Service Worker，缓存核心资源，确保断网下仍可查看已加载的项目。

---

## 9. 任务分解与优先级（工业级标准排期）

| 优先级 | 领域 | 任务 | 责任 | 预估 |
| --- | --- | --- | --- | --- |
| **P0** | **安全** | 移除前端密钥直传，改代理/Key Picker；部署 CSP；Zod 输入校验 | FE + BE | 2d |
| **P0** | **数据** | IndexedDB 迁移 + Schema Versioning；实现自动备份 | FE | 3d |
| **P0** | **工程化** | 开启 Strict TS，配置 Husky/Lint-staged/Commitlint；锁定依赖 | FE | 1d |
| **P1** | **业务** | 领域服务 (ShotService) 落地；生成前置策略校验；任务持久化队列 | FE | 3d |
| **P1** | **性能** | 虚拟滚动 (Sidebar)，组件拆分 (AssetCard)，Worker 图像处理 | FE | 2d |
| **P1** | **容错** | 部署 Error Boundaries；实现断路器模式；安全模式逻辑 | FE | 2d |
| **P2** | **测试** | E2E 测试环境搭建 (Playwright) + 核心链路用例；Unit Test 补齐 | FE | 3d |
| **P2** | **架构** | 提取 Provider 接口；实现 Code Splitting | FE | 2d |
| **P3** | **监控** | 接入 Sentry/PostHog；配置结构化日志 | FE | 1d |

---

## 10. 验收标准（Definition of Done - Industrial Grade）

1.  **安全合规**
    *   [ ] 前端代码零密钥泄漏，所有敏感操作通过鉴权代理。
    *   [ ] 通过 `npm audit` 扫描，无高危依赖漏洞。
    *   [ ] 所有 API 输入/输出均经过 Schema 校验 (Zod)。

2.  **数据完整性**
    *   [ ] 支持 ≥200MB（目标 500MB）项目数据存储且无明显卡顿；配额不足时有前置告警与降级策略。
    *   [ ] 数据库升级脚本验证通过，旧版本数据无损迁移。
    *   [ ] 意外关闭浏览器后，重启可恢复上次编辑状态（Auto-save 生效，Blob 指针有效）。

3.  **高性能与高可用**
    *   [ ] Lighthouse Performance Score > 90；LCP < 2.5s；INP < 200ms。
    *   [ ] 侧边栏 1000+ 列表项滚动 FPS > 55。
    *   [ ] 弱网/断网环境下，应用不白屏，并提示离线状态；支持已下载资产的离线回放与编辑。

4.  **工程质量**
    *   [ ] TypeScript 编译无 `any` 报错。
    *   [ ] 核心业务逻辑单元测试覆盖率 > 80%。
    *   [ ] 关键用户路径 (User Journey) E2E 测试通过。
    *   [ ] CI 流水线 (Lint, Build, Test) 全部绿色通过。

5.  **业务闭环**
    *   [ ] 生成前校验（Prompt 9/9、资产绑定、分辨率合法、队列可用）不满足即阻断并提示。
    *   [ ] 任务队列支持取消、重试、超时处理，并持久化状态。
