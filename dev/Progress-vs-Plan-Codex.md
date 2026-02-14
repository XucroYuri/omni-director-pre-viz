---
status: REFERENCE
---

# 当前实现进度 vs `dev/Plan-Codex.md`（差距盘点与重构建议）

> 历史文档说明：本文件为阶段性差距审计快照，当前实施入口为 `rules.md` 与 `docs/*`。

**日期**：2025-12-20  
**对象**：`/Volumes/SSD/Code/omni-director-pre-viz`（全项目代码 + dev 文档）  
**对标方案**：`dev/Plan-Codex.md`（已升级为“前后端分离 + Episode→Scene/Beat→Shot→Angle”）
**对标规范**：`rules.md` + `dev/Guardrails.md`（红线/门禁）

> 本文档目的：在不改现有代码的前提下，明确**当前原型已经做对了什么**、**哪里与 Plan-Codex 偏离/缺失**、以及**下一阶段建议的重构路径**与**需要需求方确认的关键问题**。

---

## 0. 总览结论
当前项目属于“高完成度 UI 原型 + 部分核心链路跑通”的状态：  
- **跑通的核心链路**：剧本→Shot 列表、Shot→9 Prompt、9 Prompt→单张 3x3 母图→Canvas 物理切片→展示/下载（部分）。  
- **偏离 Plan-Codex 的核心点**：缺少前后端分离（密钥/队列/存储/交付均仍在前端）、缺少 Scene/Beat 细分、缺少强制资产绑定闭环、缺少全局队列与可恢复任务系统、缺少命名/manifest/ZIP 交付规范、存储策略与安全策略明显不达标。

重构目标（落到“目录结构 + 输出聚合”，避免口头分离）：
- **前后端目录强制分离**：重构后必须形成 `main/`（本地后端/Worker）+ `renderer/`（UI）+ `shared/`（纯 TS 共享）三块；Renderer 禁止触达 Key/Provider/FS/DB，Main 承担所有生成与落盘（对齐 `dev/Plan-Codex.md:4.2` 与 `rules.md:4.1`）。
- **生成结果统一聚合到 `output/`**：图片/视频/manifest/ZIP 必须按 `Project/Season/Episode/Shot/Grid` 分类落在 Workspace 的 `output/` 下，作为用户“交付与素材”入口；DB 与脚本放在 `data/` 下（对齐 `dev/Plan-Codex.md:4.2.1`）。

---

## 1. 与计划一致甚至更优的实现（可保留/可复用）

### 1.1 “单母图生成 + 物理切片”主路径已经落地（与 Plan-Codex 强一致）
- **母图一次生成**：`services/geminiService.ts:186-232` 通过 `compositePrompt` 生成单张 3x3 网格图（符合“九机位仅用于母图拼接”的主路径）。
- **物理切片**：`utils/imageUtils.ts` 使用 Canvas 等分切割为 9 张子图（符合“切片不用 AI”的硬约束）。
- **UI 展示逻辑具备雏形**：`components/MatrixPromptEditor.tsx` 会在 `shot.splitImages` 存在时转为图片/视频预览模式（具备“生成后回填到矩阵模块展示”的基本框架）。

> 备注：这部分是整个项目最接近“可上线核心链路”的区域，重构时应尽量保留逻辑意图，仅迁移“执行位置”（从前端直调迁移到后端 Worker）。

### 1.2 LLM JSON Schema 约束用得很好（比多数原型更稳）
- `services/geminiService.ts:51-105`、`:134-148`、`:154-180` 使用 `responseMimeType: "application/json" + responseSchema`，这对抗 LLM 幻觉输出非常关键（Plan-Codex 里要求“schema 可校验”，这里已经做了一半）。
- `safeJsonParse`（`services/geminiService.ts:18-33`）提供容错兜底（尽管未来建议改为严格 zod 校验 + 错误码映射）。

### 1.3 资产库 UI 的产品化程度高（Plan-Codex 里可直接复用）
`components/Sidebar.tsx` 的资产库功能明显超出“原型级”：
- 资产增删改、标签、搜索、排序（`Sidebar.tsx` 多处）。
- 资产导入/导出 JSON（`Sidebar.tsx:45-112`）。
- 资产参考图上传 + AI 生成 ref + AI 扩写描述（`Sidebar.tsx:113-214`）。

> 这些 UI/交互在 Plan-Codex 的“AssetPanel”方向上是更优实现，可继续沿用，但必须把“媒体存储”从 Base64+LocalStorage 迁移为 **本地媒体库落盘（文件系统）+ SQLite 指针/索引**（并支持目录落盘/ZIP 导出）。

### 1.4 视频派生的交互已经有雏形（计划内能力的提前验证）
- `services/geminiService.ts:238-269` 提供 Veo I2V 生成（轮询）能力。
- `components/MatrixPromptEditor.tsx:78-114` 具备 per-slot 视频生成与状态字段（`videoStatus`）更新。

> 这比 Plan-Codex 的“视频派生与关联”更早出现。但当前实现 **模型与调用方式不符合红线**：最终版本必须改为 **aihubmix 的 Sora2**，且视频调用只能发生在 Main/Local-Backend（前端零密钥）。
> 注：视频模型 ID 已确认是 `sora-2`（Sora-2）。

---

## 2. 与计划偏离/缺失/背离的实现（必须重构或替换）

### 2.1 前后端未分离：密钥暴露、队列缺失、媒体存储脆弱（与 Plan-Codex 背离）
Plan-Codex 的关键升级是“**前端零密钥 + Main/Local-Backend 统一队列治理 + 本地媒体库（文件系统）+ SQLite 元数据**”。当前项目反向而行：
- **前端注入密钥**：`vite.config.ts:12-15` 将 `GEMINI_API_KEY` 注入为 `process.env.API_KEY`，这意味着密钥会进入前端 bundle（不可接受）。
- **服务层直接读 key**：`services/geminiService.ts:14-16` 使用 `process.env.API_KEY` 初始化 SDK，仍属于“前端直持密钥”。
- **更严重：把 key 拼到下载 URL**：`services/geminiService.ts:266` `fetch(`${downloadLink}&key=${process.env.API_KEY}`)`，属于高危泄漏路径（URL 极易被日志/代理/浏览器记录）。
- **队列缺失**：生成图片/视频均是直接触发调用；缺少“按能力分池并发（LLM=10/IMG=5/VID=3）+ 排队”状态机（Plan-Codex 的核心能力之一）。
- **生产构建离线不可用**：`index.html` 依赖 Tailwind CDN / importmap / esm.sh（与 Plan-Codex 的“离线可运行、可开源发布”硬约束冲突）。

结论：这一部分属于“必须推倒重来”的架构层差异，且与需求方“高性能、高安全、前端安全”诉求直接冲突。

### 2.2 Episode 内分层（Script→Scene/Beat→Shot→Angle）尚未实现
当前数据模型基本停留在“Script→Shots”：
- `types.ts` 只有 `Shot`，没有 `Scene/Beat/Angle` 的实体表达。
- `services/geminiService.ts:51-105` 的拆解输出 schema 仅包含 `context + shots + characters`，缺少 Scene/Beat 层级。
- UI（`Sidebar.tsx`）的时间线展示是 shots map（`Sidebar.tsx` 约 300+ 行附近），不具备 Scene/Beat 视图与聚合能力。

风险：对于“室内情景剧/少场景”类型剧本，会出现 Beat 粒度不足，导致后续镜头拆解不够细，直接偏离需求方“清晰细致解析”的目标。

### 2.3 Shot ↔ Asset 绑定链路几乎是空的（属于缺损实现）
Plan-Codex 强调“至少 1 角色 + 1 场景绑定”的强校验与 Ref 注入；当前 UI/状态并没有真正打通：
- `App.tsx:169-171` 传给 `MatrixPromptEditor` 的 `onDeleteGlobalAsset/onUpdateGlobalAsset/onOptimizePrompts/onAutoLinkAssets` 全是空实现，等于关键能力缺失。
- `components/MatrixPromptEditor.tsx:213-220` `AssetBubble` 的 `onUnlink={() => {}}` 是空实现；且 `AssetBubble` 内的 click 逻辑是 `!active && onUnlink()`（语义也反了：应是 link/unlink）。
- `services/geminiService.ts:207-218` 母图生成会注入 `shot.characterIds/sceneIds` 对应的 `refImage`，但由于绑定链路空，`selectedAssetsWithImages` 大概率为空 → **一致性约束形同虚设**。

### 2.4 生成/交付规范（命名、manifest、ZIP）缺失（与 Plan-Codex 不一致）
Plan-Codex 规定：
- 命名：`{EpisodeID}_{SceneID}_{GridID}_GridMaster.png` + `..._Angle_{01-09}.png`
- ZIP：服务端生成并包含 `manifest.json`

当前项目：
- 下载逻辑是浏览器 `a.download = ...`（`MatrixPromptEditor.tsx:116-124`），命名仅 `S_{shotId前4位}_{机位}.png`，与 Episode/Scene/GridID/slot 规范完全不一致。
- 没有 `manifest.json` 与可追溯交付包；没有 ZIP 打包导出。

### 2.5 存储方式与媒体表示不符合计划（且会在真实数据量下崩溃）
- `App.tsx:61-65` 将 `breakdown` 整体写入 `localStorage`，其中包含 Base64 母图/切片/视频 objectURL（未来还会增长），极易超过浏览器配额。
- `types.ts` 的 `Character.refImage` 是 Base64 字符串；`Sidebar.tsx` 上传会把图片转为 DataURL 存入内存与 config，再被 localStorage 持久化（可造成卡顿/崩溃）。

Plan-Codex 已改为 **本地文件系统媒体库（落盘）+ SQLite 元数据（指针/索引）+ 导出目录/ZIP**，当前实现需要整体迁移。

### 2.6 Prompt 策略与需求存在冲突（语言策略）
- `constants.ts:SYSTEM_INSTRUCTION_MATRIX` 明确要求 “每个 Prompt 必须是英文”，与当前规划的“按剧本主体语种输出（默认中文）+ 英文镜头术语”冲突。
- 风险：会降低可编辑性与可读性，并可能导致与原文锚点的对照困难（尤其在中文剧本场景）。

---

## 3. 详细重构思路（从当前原型到 Plan-Codex 目标形态）
> 核心策略：**分阶段“收敛风险”**，优先把高危点（密钥/队列/存储）迁移到后端，再逐步补齐 Scene/Beat 与交付规范。避免“一步到位大翻新”导致停摆。

### 3.1 第 0 阶段：定义后端“权威合约”（先定规矩再动工）
输出物（文档/Schema）：
- 统一错误码：`AUTH_REQUIRED / QUOTA_EXCEEDED / POLICY_VIOLATION ...`（Plan-Codex 已有）。
- `manifest.json` JSON Schema（包含 `ipId/projectId/seasonId/episodeId/sceneId/beatId/shotId/gridId/slots`）。
- Episode 内部实体 schema：`Scene/Beat/Shot/Angle`（Angle 9 槽强制归一为 `string[9]`）。

### 3.2 第 1 阶段：后端代理 + 前端零密钥（安全先行）
目标：前端不再直接 import `@google/genai`，也不再拥有任何 Provider key；所有调用通过 **Electron Main/Local-Backend** 执行，Renderer 仅发起任务并订阅状态。

建议“本地后端（Main）”最小闭环：
- IPC/API：接收 `breakdown/matrix/render/video/export` 请求，统一入队 `TaskQueue`。
- Worker：执行 Provider 调用（**aihubmix 唯一来源**；视频 **仅 Sora-2（`sora-2`）**；禁止任何官方直连与任何回退分叉）。
- Media：母图/切片/视频统一落盘到 Workspace 的 `output/` 目录（按 `Project/Season/Episode/Shot/Grid` 分类）；DB 仅存元数据与文件指针；Renderer 通过安全的媒体访问策略（自定义协议或受控读取）展示。
- Progress：任务状态通过 IPC push（或轮询 fallback）更新 UI。

前端改造方向（下一阶段实现，不在本文动代码）：
- `services/geminiService.ts` 演进为 `services/ipcClient.ts`（或等价），所有调用改为“任务提交 + 状态订阅”（IPC `invoke` + push/轮询）。
- `vite.config.ts` 去除注入 key。

### 3.3 第 2 阶段：把“Scene/Beat”引入拆解与 UI（质量提升核心）
后端新增：
- `POST /api/episodes/:episodeId/segment`：脚本→`scenes[] + beats[]`（Beat 优先，Scene 辅助）。
- `POST /api/episodes/:episodeId/breakdown`：在 beat 维度产出 `shots[]`（每个 shot 必须含 `sceneId/beatId` + 原文锚点）。

前端新增视图（建议从 Sidebar 的 timeline 进化）：
- Scene 折叠容器（可选）→ Beat 列表（主）→ Shot 列表（子）。
- 仍保持“选中 shot → 进入矩阵编辑器”的主工作流不变。

### 3.4 第 3 阶段：资产绑定闭环 + 强校验（让一致性真正生效）
关键点：
- 绑定关系由后端持久化（Season 资产库 + Episode 引用关系）。
- GenerationPolicy 由后端执行；前端只做镜像提示。
- Ref 注入在后端 Worker 组装 prompt 与 request parts 时完成（避免前端处理 Base64）。

落地步骤：
1) 资产导入改为“本地选图/拖拽导入”，主进程负责落盘并返回 `refMediaId`（或文件指针）。
2) Shot 绑定 assetIds；生成前检查 `linkedCharacters>=1 && linkedScenes>=1`。
3) Worker 渲染母图时注入绑定资产的 ref。

### 3.5 第 4 阶段：交付规范（命名/manifest/ZIP）与历史版本
主进程实现：
- GridRender 版本化：`gridId` 自增；单机位覆盖记录 `slotRevision`。
- `POST /api/episodes/:episodeId/export`：本地生成 ZIP（或优先目录落盘），返回本地路径/下载句柄。
- 生命周期策略：限制历史版本数量，避免存储成本失控。

---

## 4. 关键拍板记录（供实现期引用）
1) **本地后端形态（已拍板）**：锁定 Electron Main/Local-Backend 为第一阶段唯一落地形态（公网 Server 仅作为后续可选）。
2) **Key 配置体验（已拍板）**：交付产物不含 key；首次运行/缺失/不可用必须弹窗提示输入；加密落盘并设备绑定自动失效销毁（细则见 `rules.md` 与 `dev/Plan-Codex.md`）。
3) **并发上限定义（已拍板）**：按能力分类型限流：`LLM=10` / `IMG=5` / `VID=3`；并在 Provider 侧临时限流/并发超限时做“临时自动降级并发 + 冷却期恢复”。
4) **强制绑定规则（已拍板）**：允许 `shotKind=ENV` 豁免角色绑定，但**必须绑定场景**（用于空镜/环境展示的多角度生成）。
5) **Prompt 语言规范（已拍板）**：默认按剧本主体语种（`scriptLanguage`，默认中文）输出 + 英文镜头术语；不得强制全英文（对齐 `rules.md`）。
6) **命名策略（已拍板）**：机位/格子文件名使用 `Angle_{01-09}`（避免 `Shot/Angle` 语义冲突）；镜头实体仍为 `shotId`，Beat 关联写入 `manifest.json`。
7) **Scene/Beat 的输出粒度（已拍板）**：Beat 优先“拆得更细”；默认目标 `15~30` beats/episode；必须支持“手动合并/拆分 beat”。
8) **视频派生策略（已拍板）**：默认以 3x3 GridMaster 作为参考源；视频生成由用户手动选择 Shot/slot；为匹配 Sora-2 单参考图输入，Worker 应从 GridMaster 裁切选中 slot 作为 `firstFrameImage`（并写 Ref Semantics）。
9) **本地数据保留策略（已拍板，MVP）**：仅“手动清理 + 导出后可选清理 + 超配额提示”，不做自动删除。

---

## 5. 结论与建议落地顺序（强烈建议）
1) **先安全**：前端零密钥 + Main/Local-Backend 代理（aihubmix-only）+ 加密落盘 key + 任务队列强制调度。  
2) **再质量**：Scene/Beat（Beat 优先）引入拆解链路，提升解析清晰度。  
3) **再一致性**：资产绑定闭环 + GenerationPolicy 强校验，真正做到“角色不跑偏”。  
4) **最后交付**：命名/manifest/ZIP、历史版本、视频关联、成本治理。
