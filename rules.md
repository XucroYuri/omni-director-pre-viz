# 项目开发规范 (Rules & Guidelines)

本文档规范 Omni-Director Pre-viz Workstation 的开发流程、技术边界与协作方式。当前优先级以需求方新增目标为准：**macOS / Windows / Linux 三端本地一键运行（绿色整合包）+ 可 GitHub 开源发布**，同时避免过度设计，聚焦核心工作流与用户体验。

**对标方案**：`dev/Plan-Codex.md`

## 0. 双入口互认（必读）

为确保任何 AI Agent 从任意入口进入都能遵守同一套规则：
- **人类/项目入口**：`rules.md`（本文件，业务与安全红线的完整说明）
- **Agent 入口**：`.trae/rules/`（对 `rules.md` + `dev/Guardrails.md` 的“可执行门禁化”提炼）

要求：
- **必须同时遵守**：`rules.md` 与 `.trae/rules/*`（以及 `dev/Guardrails.md`）。
- 若发现冲突：以 `dev/Consensus-Lock.md` 的已拍板结论为准，并先停手提出澄清/修正文档。

---

## 1. 核心目标与非目标

### 1.1 核心目标（必须达成）
- **剧本解析质量**：Episode 内按 `Script → Scene/Beat → Shot → Angle` 拆解，**Beat 为主、Scene 为辅**，确保少场景/室内剧也能细致解析。
- **生成策略正确**：默认 **1 次调用生成 1 张 3x3 母图**，再物理切片 9 张 Angle；单 Angle 生成仅用于局部修正。
- **一致性可控**：资产（角色/场景/道具）可绑定；生成前强制校验（至少 1 角色 + 1 场景，除非需求方定义豁免规则）。
- **交付可追溯**：命名规范 + `manifest.json` + ZIP 打包导出。
- **前端安全**：前端零密钥；密钥只存在后端/桌面主进程；禁止 URL/日志/持久化泄漏。
- **本地三端一键运行**：用户双击即可跑通完整工作流，无需安装 Node/Python/Redis。

### 1.2 非目标（第一阶段刻意不做）
- 不为“未来可能的云协作”提前引入重架构（NestJS/tRPC/Redis/Postgres/S3 等），除非它们直接解决当前核心痛点。
- 不做过度抽象（多层 Provider/Repository/DDD 全家桶），保持边界清晰但实现务实。

---

## 2. 交付形态（优先级）

1) **Desktop Local-first（强制）**
- 运行方式：桌面应用（推荐 Electron）。
- 后端能力：本地随应用启动的 API/Worker（同机），以 IPC 或 localhost HTTP 实现。
- 存储：SQLite（元数据）+ 文件系统（媒体文件）+ ZIP 导出。

2) **Server（可选后续）**
- 若未来需要多人协作/云资产库：再演进为公网 API + Worker + 对象存储 + 队列。
- 仍遵守“前端零密钥”“任务队列强制调度”“manifest 交付可追溯”等红线。

---

## 3. 业务层级与名词（避免误解）

### 3.1 行业分层（背景信息）
1) **IP**：概念层（如“漫威宇宙”“西游记”）。  
2) **Project**：世界观/作品层（同名连续叙事）。  
3) **Season**：资产共用层（跨多 Episode 复用角色/场景/道具）。  
4) **Episode**：实体作业层（本应用一次工作流的最小闭环单位）。

### 3.2 Episode 内部拆解（实现必须对齐）
- `Script`：原始剧本文本（必须原文保护）。
- `Scene`：基于时空/表演空间切分的粗粒度容器（辅助聚合与资产提示）。
- `Beat`：基于剧情单元的细粒度拆分（主导解析质量）。
- `Shot`：叙事最小单元（必须携带原文锚点 + 视觉转译）。
- `Angle`：制作冗余机位（九机位矩阵属于同一 Shot 下的 9 个 Angle）。

---

## 4. 关键业务红线（Critical Red Lines）

### 4.0 Style Preset（图像/视频两套，Episode 级必须存在）
- 每个 `Episode` 必须配置两套 Preset（彼此独立）：
  - **Image Style Preset**：用于 3x3 母图（图片模型）
  - **Video Style Preset（Sora2 / `sora-2`）**：用于视频生成（Sora-2）
- **禁止混用**：图片与视频的 Style Preset 不应共用同一段文本（两类模型对风格词的敏感度与最佳实践不同）。
- **拼接原则（核心纠偏）**：
  - `Angle` 九机位文本（9 槽）应保持 **Style-free**（不包含 Style Preset），只描述“机位差异 + 内容”。
  - 触发生成时，由主进程在“母图生成 JSON 提示词”顶层注入 **Image Style Preset**，从而覆盖所有 Angle。
- 视频生成时，在视频 Prompt 顶层注入 **Video Style Preset（Sora2 / `sora-2`）**。
- 允许修改 Preset，但必须提示影响范围：是否对历史图片/视频做重生成由用户选择（保持可追溯版本）。

### 4.1 前端零密钥（Zero-Secret Frontend）
- **严禁**把任何第三方 Provider Key 注入前端 bundle（包括 `vite define process.env.*`）。
- **严禁**把 key 拼接到 URL、写入 LocalStorage/IndexedDB、或出现在日志明文。
- 所有 LLM/Image/Video 调用必须在 **后端/桌面主进程** 执行，前端只发起任务并订阅进度。

### 4.1.3 API Key 引导、加密存储与设备绑定（交付产物不得带 Key）
- **交付产物不得包含任何 API KEY**：Release/安装包/默认配置里不能内置 key。
- **缺失或不可用必须阻断**：首次启动、Key 缺失、或 Key 测试失败时，必须弹窗提示用户输入/更新 Key；在 Key 就绪前，生成类主流程（LLM/图片/视频）不得可用（允许浏览/编辑离线功能）。
- **加密永久化存储**：Key 必须加密存储；优先使用 OS Keychain/凭据库作为根（设备绑定天然生效），避免“拷贝应用数据目录即可复用”。
- **设备变更自动失效销毁**：检测到设备/安装实例变化（例如无法从 Keychain 取回密钥、或设备指纹不一致）时，必须自动销毁本地 Key（清空密文与缓存）并要求重新输入。
- **产品侧发放建议**：若 Key 由产品方提供，应为每个授权用户/设备发放独立 Key（可吊销/可轮换），并配合“激活/授权”机制（规划可在 `dev/Plan-Codex.md`，实现由维护者拍板）。

### 4.1.2 Electron 安全边界（preload 最小暴露）
> Electron 桌面形态下，“preload 暴露面”就是前端安全的一部分：只要 preload 暴露过宽，就等同于把主进程能力（含密钥/文件系统）送进前端。

- **必须**开启 `contextIsolation`，并保持 `nodeIntegration=false`
- preload 只允许暴露“白名单 API”（例如 `window.omnidir.*` 的少量方法），**禁止**直接暴露 `ipcRenderer`、`fs`、`child_process` 等任意 Node 能力
- IPC 通道必须“按能力命名 + 参数 Schema 校验”，禁止“万能通道”（例如 `invoke(channel, payload:any)` 直接透传到主进程执行）

### 4.1.1 Provider Source 红线（aihubmix 唯一来源）
> 说明：aihubmix 同时提供不同兼容形态的端点；无论采用哪种 SDK/协议，**都必须只打到 aihubmix**。

- **唯一来源**：本项目的 AI 调用只允许通过 aihubmix 端点进行：
  - Gemini 兼容：`https://aihubmix.com/gemini`
  - OpenAI 兼容：`https://aihubmix.com/v1`（例如视频模型 `sora-2`）
- **禁止直连**：禁止从应用直连 Gemini 官方 API / OpenAI 官方 API（无论是 Renderer 还是主进程），避免多 Provider 分叉与开源安全风险。

vFuture（未来演进预留）：
- 允许在代码结构上预留“多 Provider 抽象”（接口/路由/配置结构/manifest 字段），但 **当前版本运行时仍必须是 aihubmix-only**。
- 若未来要引入新的 API 服务商或主备切换：必须先由维护者更新本节规则与 `dev/Guardrails.md` 并补齐验收用例；否则任何多 Provider 实现一律视为违规。

### 4.2 矩阵生成策略（主路径纠偏）
- **唯一路径**：`1 次绘图调用 → 1 张 3x3 母图 → 物理切割 → 9 张 Angle 子图`。
- **禁止**：严禁对每个 Angle 分别调用绘图 API（单 Angle 修正除外）。
- **单 Angle 修正**：默认低分辨率（如 1K），仅覆盖对应切片，并记录可回滚版本。

### 4.2.1 画幅白名单（硬约束）
需求方明确：图像与视频画幅仅需要 `16:9` 与 `9:16`。
- **仅允许**：`{16:9, 9:16}`
- **禁止**：后续开发过程中主观添加其他比例画幅（即便“看起来更通用”也不允许）
- **适用范围**：母图生成（图片模型）与视频生成（Sora2）

### 4.2.2 Prompt 语言策略（剧本语种优先，默认中文）
- Prompt 默认采用**剧本主体语种**（`scriptLanguage`）：除专业术语外，使用剧本主体语种进行描述；允许“视觉化微调 + 专业英文镜头术语”混排。
- 若无法可靠判断 `scriptLanguage`：默认中文（除非 PM/用户明确指定）。
- 适用范围：
  - 3x3 母图生成 Prompt
  - 单 Angle 修正 Prompt
  - 视频生成 Prompt（Sora2 / `sora-2`）
- 禁止策略：不得为了“模型偏好”强行把全部 Prompt 改为英文；如需英文增强，必须以“术语段/参数段”形式追加，而不是覆盖中文主体叙事。

### 4.2.3 母图生成提示词格式（JSON，顶层注入 Style）
- 母图生成必须使用结构化 JSON（由主进程组装），避免散落拼接造成不一致：
  - 顶层字段包含：`imageStylePreset`、`consistencyRules`、`assets`、`angles[9]`
  - `angles[i]` 仅包含 Angle 的“内容描述”（Style-free）
- 目标：确保 **Image Style Preset 一次注入，覆盖 9 个 Angle**，并避免单格 Prompt 被误改导致风格分叉。
- **拼接顺序（强制）**：向 Provider 发送的最终 Prompt/JSON 中，Preset 与一致性约束必须位于动态内容之前：
  1) `imageStylePreset` / `videoStylePreset`
  2) `consistencyRules`（Identity/Environment/Prop Lock 等）
  3) `assets`（含 Ref Map/参考图语义说明）
  4) `angles[9]`（仅内容与机位差异；Style-free）

### 4.2.4 网格切片鲁棒性（P0，主路径地基）
- 母图 Prompt 必须包含“严格 3x3 等分网格”约束（由主进程统一拼接）
- 切片必须支持“安全裁切 margin”（默认内缩，避免切到边框线/黑边）
- 推荐提供一次性“网格校准”并保存到 Episode 配置，后续切片复用

### 4.3 资产注入与一致性
- **强制校验**：生成前必须校验至少绑定 `1 角色 + 1 场景`（若允许空镜/环境镜头豁免，必须产品侧定义规则与标签）。
- **注入逻辑**：
  - 有参考图：以文件/Blob 形式注入（由后端/主进程负责），并必须同时注入“参考图语义说明”（Ref Semantics），明确每张图用于锁定什么（身份/服装/场景/道具/首帧）。
  - 无参考图：降级为文本特征描述注入 Prompt（并提示一致性风险）。

### 4.3.0 参考图语义说明（Ref Semantics，必须可读且可追溯）
> 目标：让“多参考图输入”对模型是**可理解**的，同时让人类能从 prompt 里看懂“每张图的作用”，避免把参考图当作风格贴图/拼贴指令。

通用要求（图片/视频均适用）：
- **必须**：只要请求里携带了图片输入（1 张或多张），文本 prompt 中就必须包含对应的 Ref Semantics 段落。
- **必须**：每张参考图都要有“性质 + 文件名 + 用途”三要素；属于资产库的，还要加上资产名/角色名/道具名以便对账。
- **禁止**：把参考图描述成“把这张图贴到画面里/拼贴/加水印/加文字”；参考图只能用于“锁定一致性/首帧引导”。

#### 4.3.0.1 生图（图片母图/单角度）Ref Semantics 格式（建议标准化）
当同一镜头调用多张参考图时，建议统一使用以下结构（插入到 Preset 与 Consistency Locks 之后、Angles/内容之前）：

```text
[REFS]
[CHAR] 角色名="{CharacterName}" 参考图="{fileName}" 用途=身份一致性(脸/发型/服装关键特征保持一致)
[SCENE] 参考="{sceneFileName}" 用途=场景一致性(空间布局/光线氛围/色彩基调对齐)
[PROP] 道具名="{PropName}" 参考图="{propFileName}" 用途=道具一致性(形状/材质/尺度/摆放关系保持一致)
[/REFS]
```

最低要求（按资产分类）：
- 角色（CHAR）：**必须**用“`[角色名] ↔ [图片文件名]`”成对说明；并明确“保持角色一致性”。
- 场景（SCENE）：**必须**在场景相关文字处标注“`[参考：场景图片文件名]`”（或等价语义）。
- 道具（PROP）：**必须**用“`[参考图：道具图片文件名]`”嵌入，并说明道具要保持一致性（形状/材质/尺度/摆放）。

#### 4.3.0.2 多参考图能力与 Ref Map
- 若 Provider/模型支持多图输入：每张图都必须有独立语义说明（见 4.3.0.1）。
- 若只支持单图输入但需要多主体：必须使用“拼图 + Ref Map”（见 4.3.3），并在 Ref Semantics 中明确每个格子的含义与对应约束对象。

### 4.3.1 角色一致性（参考图 + Prompt 对齐引导）
- 角色一致性不是“上传参考图就结束”，必须额外生成并锁定一段 **Identity Lock Prompt**（角色身份锁定描述），用于：
  - 将参考图中的稳定特征转成可复用的文字约束（发型/服装/配饰/伤疤/年龄段/体型/色彩/材质等）
  - 约束 9 个 Angle 的一致性（同一角色跨机位不跑偏）
- 允许引入 “Prompt Optimizer（提示词优化器）”，但其输出必须可追溯到角色参考图与用户输入描述；禁止生成与参考图明显矛盾的新设定。

### 4.3.2 场景/物品一致性（输入方法）
- 场景一致性：绑定 `Scene` 实体 +（可选）场景参考图 + 场景锁定描述（Environment Lock Prompt）。
- 物品一致性：绑定 `Prop` 实体 +（可选）道具参考图 + 道具锁定描述（Prop Lock Prompt）。
- 若没有参考图，必须通过“结构化文本约束”增强一致性（例如颜色/材质/摆放关系/时代风格）。

### 4.3.3 多参考图拼图输入（必要时启用）
当同一镜头需要同时锁定多主体（多角色/角色+场景/关键道具）且单张参考图不足以表达时，允许启用“多参考图拼图”策略：
- 将多张参考图拼成一个标号网格图（例如 2x2 或 3x2），作为单张图片输入给绘图模型。
- 同时在 Prompt 中加入 **Ref Map 描述**，明确每个格子是什么主体，以及它与生成内容的对应关系（例如：`Grid A=主角脸部特征, Grid B=服装, Grid C=场景光影, Grid D=关键道具`）。
- 该拼图与 Ref Map 必须由主进程生成并保存到媒体库，作为可复用资产（避免每次重新拼图）。

### 4.4 任务队列（可观察 + 可恢复）
- 所有生成任务（LLM/Image/Video）进入全局 `TaskQueue`。
- 并发上限按能力分类型限流：`LLM=10` / `IMG=5` / `VID=3`；必须具备：超时、退避重试、结构化错误码、可取消；并在 Provider 侧临时限流/并发超限时做“临时自动降级并发 + 冷却期恢复”。

### 4.4.1 模型 ID 锁定（防止 Agent 擅改）
需求方要求：在 aihubmix 中调用的 **LLM/绘图/视频模型 ID** 必须“锁定”，避免任何 LLM/Agent 基于旧预训练知识擅自修改。

- **强制做法**：
  - 模型 ID 仅允许集中定义在一个文件（例如 `constants/modelIds.ts` 或主进程 `modelIds.ts`）。
  - 每个模型常量上方必须写“锁定注释”：`MODEL ID LOCKED - ONLY MAINTAINER CAN CHANGE`。
  - 协作约定：任何模型 ID 变更必须由维护者本人提交（或明确授权），其他 PR 一律拒绝。

已拍板的模型 ID（当前版本必须保持不变）：
- TEXT（LLM，用于 Script/Segment/Matrix/Optimize 等）：`gemini-3-flash-preview`（aihubmix Gemini 兼容端点：`https://aihubmix.com/gemini`）
- IMAGE（母图生成）：`gemini-3-pro-image-preview`（aihubmix Gemini 兼容端点：`https://aihubmix.com/gemini`）
- VIDEO（视频生成，Sora-2）：`sora-2`（aihubmix OpenAI 兼容端点：`https://aihubmix.com/v1`）

来源（供追溯，不作为实现 SDK 限制）：
- `https://aihubmix.com/model/gemini-3-flash-preview`
- `https://aihubmix.com/model/gemini-3-pro-image-preview`
- `https://aihubmix.com/model/sora-2`

### 4.4.2 视频模型红线（仅 Sora2 / `sora-2`）
- **唯一允许的视频模型**：仅允许使用 aihubmix 的 `Sora2` 视频模型进行生成（模型 ID：`sora-2`）。
- **禁止**：当前版本禁止接入/调用任何其他视频模型（包括 Veo 等），无论出于“更快/更便宜/更新”的理由。
- **锁定要求**：视频模型 ID 必须被锁定注释保护，并且只允许维护者人工修改。

### 4.5 命名规范 + manifest + ZIP（交付硬标准）
- 母图：`{EpisodeID}_{SceneID}_{GridID}_GridMaster.png`
- 切片：`{EpisodeID}_{SceneID}_{GridID}_Angle_{01-09}.png`（`Angle_{01-09}` 为固定 1-9 的机位 slot）
- ZIP 内必须包含 `manifest.json`，可追溯到：`ip/project/season/episode/scene/beat/shot/grid/slot`。
- **输出聚合**：所有生成结果（母图/切片/视频/manifest/ZIP）必须聚合保存到 Workspace 的 `output/` 目录下并分类（按 `Project/Season/Episode/Shot/Grid`），作为用户“交付与素材”入口。

### 4.6 负面清单（禁止采纳/禁止实现）
> 目的：把“看似方便但必然带来安全/成本/一致性灾难”的路径写死，减少后续团队误入歧途。

- **安全与开源红线**：禁止把任何 Key 注入前端 bundle/URL/本地明文持久化/日志；禁止直连任何官方 API（只允许 aihubmix：`https://aihubmix.com/gemini` 或 `https://aihubmix.com/v1`）。
- **路线漂移**：禁止接入除 Sora-2（`sora-2`）之外的视频模型；禁止让 LLM/Agent 自动改模型 ID 或自动增加 Provider 回退/主备切换逻辑（除非维护者已更新规则并明确启用 vFuture 多 Provider）。
- **成本与一致性崩坏**：禁止把九宫格当成 9 次绘图 API 调用（除单 Angle 修正）；禁止把 Style Preset 写进每个 Angle 文本（必须顶层注入覆盖）。
- **存储与性能灾难**：禁止 Base64/DataURL 长期保存 2K/4K 图片到内存/LocalStorage；禁止把大 Blob 常驻 React state；大资源必须落盘/走引用。
- **离线与发布失败**：禁止生产依赖 CDN/importmap/在线字体作为运行前置条件。
- **过度设计**：桌面 MVP 阶段禁止引入 Redis/BullMQ/Postgres/OSS/NestJS 集群等云端重组件（除非已明确进入云协作版本）。

---

## 5. 技术栈与工程约束（MVP）

### 5.1 桌面端（推荐）
- **Electron + electron-builder**：构建 `dmg` / `portable.exe|zip` / `AppImage`。
- 元数据：SQLite
- 媒体：文件系统（默认 `{WorkspaceRoot}/OmniDirector/output`；用户可配置；内部缓存可使用 `{appData}` 但不得替代 output 的交付口径）
- 进度推送：IPC 或 SSE（本地 HTTP 时）

### 5.2 前端（离线可运行）
- React + TypeScript + Vite
- Tailwind：生产构建必须本地打包，禁止依赖 CDN/importmap/在线字体（必要时内置字体或使用系统字体）。

### 5.3 i18n（中英双语切换）
- UI 必须支持 i18n：中/英双语切换（默认中文）。
- 文案管理必须集中化（例如 `locales/zh-CN.json`、`locales/en-US.json`），禁止散落硬编码。
- i18n 资源必须随离线构建一起打包，不能依赖在线拉取。

### 5.3 代码风格
- TypeScript：尽量开启 `strict`（至少新代码不引入 `any`）。
- 函数式组件 + Hooks；避免 God Component。
- 所有 LLM 输出：必须 Schema 校验（zod 或等价方案），不得只 `JSON.parse`。

---

## 6. GitHub 开源与发布（Release Ready）
- 仓库只提交 `.env.example`，不提交任何真实密钥/令牌。
- GitHub Actions matrix 构建三端产物并发布 Release。
- 产物建议：
  - macOS：`dmg`
  - Windows：`portable.exe` 或 `zip`（绿色包）
  - Linux：`AppImage`
- 增补开源必需文件：`LICENSE`、`CONTRIBUTING.md`（可选）、`SECURITY.md`（可选）、第三方依赖声明（如需）。

### 6.1 发布安全与反仿造（务实约束）
- **不可幻想“绝对防破解”**：桌面端天然可被逆向；目标是“提高仿造成本 + 防滥用 + 可追溯”。
- **必须签名发布**：生产发布产物需代码签名（macOS Notarization/Hardened Runtime；Windows Authenticode；Linux 提供签名/哈希校验），并在 Release 页提供校验方式。
- **签名密钥永不入库**：证书、私钥、notary 凭据、激活服务私钥等必须只存在于本地安全环境或 CI Secrets；严禁出现在仓库文件/日志。
- **授权与密钥联动**：激活/授权态作为“允许写入/使用本地加密 API Key”的前置条件；设备变化需自动失效销毁（见 4.1.3）。

---

## 7. Vibe Coding（AI 协作）纠偏方法
> 目标：把“AI 会写代码”变成“可控、可验收、可复盘”的工程协作。

### 7.1 输入标准（PM → Agent）
- **必须给清楚**：一句话目标 + 非目标 + 约束/红线 + 交付物 + DoD（可判定验收标准）+ 输入材料（最小复现/日志/样例）。
- **推荐模板**：`dev/reference_vibe-coding-skill/templates/Task-Brief.md`
- **优先级提醒**：任何约束冲突时，以 `rules.md` / `dev/Guardrails.md` / CI 门禁为准。

### 7.2 执行标准（Agent 行为约束）
1) 永远先对齐“红线”（单母图路径、前端零密钥、命名+manifest、Beat 优先、aihubmix-only、Sora-2-only=`sora-2`、模型 ID 锁定）。
2) 先读再改：先定位权威文件与现有实现，再做判断；不靠预训练常识推断仓库结构与接口。
3) 复杂模块先写：状态机/错误码表/伪代码/数据结构，再写实现（避免“边写边想”造成不可控分叉）。
4) 假设 LLM 输出总是坏的：Schema 校验 + 错误分类 + 兜底提示；不得用“宽松 parse”掩盖结构问题。
5) 变更必须可追溯：关键结论与改动点要引用**文件路径**，必要时带**关键行号**，避免“幻觉修改/幻觉验证”。
6) 变更面最小化：一次任务只解决一类问题；禁止未被要求的大重构/大搬家/换技术栈。
7) 触碰锁定区域必须显式标注：并提示“需要维护者 Review/门禁标签”。

### 7.3 交付标准（Agent → PM）
- 交付必须包含：完成情况（对齐 DoD）/ 改动清单（文件路径）/ 验证步骤（可复现）/ 风险与回滚。
- **推荐模板**：`dev/reference_vibe-coding-skill/templates/Change-Report.md`

---

## 8. dev 文档模板（异步协作）
在 `dev/` 目录创建记录文件（如 `dev/log_YYYYMMDD_xxx.md`）时使用（也可配合 `dev/reference_vibe-coding-skill/templates/Change-Report.md` 作为交付摘要）：

```markdown
# 模块/功能开发记录

**日期**: YYYY-MM-DD
**作者**: Name
**状态**: Planning / In Progress / Completed

## 1. 目标
要解决的用户问题与验收标准。

## 2. 方案
- 数据结构 / Schema
- 状态机 / 伪代码
- 边界与错误码

## 3. 取舍
- 为什么不采用更重的方案（避免过度设计）

## 4. 验证
- [ ] 核心路径手测
- [ ] 构建/打包通过
```

---

**最后更新**: 2025-12-20  
**维护者**: @XucroYuri
