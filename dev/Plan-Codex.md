---
status: SUPERSEDED
---

# Plan-Codex（vNext 比稿版）：面向最初需求的落地开发方案与任务分解

> 历史文档说明：本文件保留为历史方案快照，不再作为当前实施入口。当前请以 `rules.md` 与 `docs/*` 为准。

> 当时权威实施标准（历史口径）：本文档（`dev/Plan-Codex.md`）+ `rules.md` + `dev/Guardrails.md`。`dev/Plan-Electron-Standalone.md` 仅为 Electron 工程落地参考，不得覆盖本文口径；共识锁定见 `dev/Consensus-Lock.md`。

**作者**：Codex（方案提案/比稿版本）  
**范围**：仅规划与文档，不改动现有代码（代码实施为下一阶段）。  
**目标**：在现有原型基础上，严格对齐《产品方案 V4.0》完成端到端闭环：**时序拆解 → 九机位矩阵（仅用于母图拼接）→ 单张 3x3 母图生成 → 物理切片 → 交付（命名/ZIP/manifest）→ 可选视频派生与关联**。

**相关权威文档**（实现阶段必须遵守）：
- `rules.md`：业务/安全/交付红线（尤其是“前端零密钥”“aihubmix-only”“Sora-2-only=`sora-2`”“模型 ID 锁定”“单母图+物理切片”）
- `dev/Guardrails.md`：锁定区域与 CI/CODEOWNERS 门禁（防止关键参数被误改）
- `dev/reference_vibe-coding-skill/Vibe-Coding-Standard.md`：PM/Agent 协作标准（任务输入/交付格式/质量门禁）

---

## 0. 一句话结论（决策用）
采用**桌面端本地优先的前后端分离**（Renderer/UI 与 Main/Local-Backend 分离）实现“前端零密钥、后端统一队列治理”，并以“**单母图生成 + 物理切片**”为唯一主路径：通过 **GenerationPolicy 强制校验（Prompt 9/9 + 至少 1 角色 + 至少 1 场景）**、**本地可恢复任务队列（SQLite+In-Memory）**、**本地文件系统媒体库 + ZIP/manifest 交付** 达成高一致性、可追溯交付与可恢复运行；**AI 调用仅使用 aihubmix（作为唯一 Provider Source）**，不再直连 Gemini 官方 API，且 **所有 Provider Key 只存在 Main/Local-Backend（或后续 Server）**。

---

## 1. 现状盘点（基于现有原型）
### 1.1 已具备能力（可复用）
- SPA 结构：侧栏（剧本/镜头列表/资产）+ 中央矩阵编辑器。
- 剧本拆解（Text→JSON）、九机位 Prompt 生成（Text→JSON）、3x3 母图生成（Text+Ref→Image）、Canvas 物理切片。
- 简单视频生成入口（I2V），以及部分历史记录结构雏形。

### 1.2 与 V4.0 的差距（必须补齐）
- **生成治理**：缺少队列、进度、超时、重试与错误分类；无法批量多镜头生成并显示排队状态。
- **一致性闭环**：镜头与资产（角色/场景/道具）未形成可用绑定链路；参考图注入与触发词策略未落地为强约束。
- **命名/交付缺失**：切片命名未与 Episode/场景/母图版本挂钩；缺少 ZIP 打包与 `manifest.json` 对账单。
- **存储脆弱**：大图 Base64/历史写入 LocalStorage 风险高；缺少本地媒体库（文件系统）与元数据存储（SQLite）、导出/备份回落与历史清理策略。
- **流程偏差风险**：容易被误实现为“九机位分别生成 9 张图”，与主需求冲突。
- **Provider 策略变更**：AI 调用仅允许走 aihubmix（Gemini 兼容规范，但不直连 Gemini 官方）；参数归一化与安全边界需明确。
- **产品体验缺失 (Phase 4)**：Ratio/Resolution 前端不可选；缺乏 Video 生成确认流；Light/Dark 主题缺失；国际化 (i18n) 未落地；资产一致性策略未形成闭环。

---

## 1.3 行业分层背景与命名纠正（IP / Project / Season / Episode）
需求方已纠正：本方案此前使用的“Project（项目）”概念，按影视动画行业分层应更名为 **Episode（集）**。行业常见内容与资产分层如下：

1) **IP**（概念管理层）：具有共性或内容相关性的抽象概念（例如“漫威宇宙”“西游记”）。  
2) **Project**（内容管理层）：同名影视/动画项目，统一世界观与连续叙事（例如“某某动画”）。  
3) **Season**（资产管理层）：第 N 季，共享可复用资产（角色/场景/道具/风格基线）。  
4) **Episode**（实体层/工作单元）：本应用一次工作流的最小闭环单位，包含该集的剧本、镜头拆解、母图与切片、视频派生与交付。

**本方案的工作流与交付命名，均以 `Episode` 作为核心实体**；同时在 `manifest.json` 中保留 `IP/Project/Season` 信息，便于资产复用与跨集追溯。

---

## 1.4 Episode 内部工作流分层（Script → Scene/Beat → Shot → Angle）
为提升“剧本有效、清晰、细致解析”的质量，本方案在 `Episode` 内部采用更贴近影视制作的细分层级：

- **Episode（实体作业层）**
  - **Script（剧本）**：原始输入长文本（需原文保护）。
  - **Scene（场景）**：基于表演空间/时空切换的粗粒度切分（如 INT/EXT、场景头、地点/时间变化）。
  - **Beat（节拍）**：基于剧情单元/语义理解的细粒度切分（对“室内情景剧/少场景”尤其关键）。
  - **Shot（镜头/分镜条目）**：可视化最小叙事单元，必须携带原文锚点 + 视觉化转译。
  - **Angle（机位）**：制作冗余与剪辑选择所需的多机位版本；本产品的“九机位矩阵”即 **同一 Shot 下的 9 个 Angle**（并不等价于 9 个 Shot）。

### 1.4.1 关键策略：以 Beat 为主、Scene 为辅
- **Beat 优先**：拆解主线以 Beat 为核心，确保同一场景内不同剧情单元不会被粗切分吞没。
- **Scene 兜底**：Scene 作为空间/时空的辅助标注与聚合容器，便于后续资产复用与镜头排序。
- **实现建议**：Agent 先产出 Scene 边界（可粗），再在 Scene 内产出 Beat（细），最后在 Beat 内生成 Shot 列表。

### 1.4.3 需求方确认点：Beat 必须实现且不设上限（防“剧情压缩”）
需求方确认：**必须实现 Beat 级拆解**，原因是长文本直接拆 Shot 会被 LLM 严重压缩与遗漏；Beat 的设计目标是“缩小上下文窗口，让 LLM 没机会跳过细节（一个眼神也可能是一个镜头）”。

工程落地建议（避免 Beat 过长导致 Shot 漏拆）：
1) **两段式拆解**：先 Scene（粗）→ 再 Beat（细）→ 再 Shot（更细）。
2) **原文覆盖约束**：Beat 输出必须携带可验证的 `originalText`（或 `start/end offsets`），并要求 Beats 覆盖 Script 全文（允许重叠但禁止丢段）。
3) **Shot 在 Beat 内生成**：每个 Beat 单独调用 LLM 产出 Shot 列表，并要求 `originalText` 为原文锚点（不得改写）。
4) **人类可调**：必须提供“合并 Beat / 拆分 Beat”的手动编辑能力（Beat 不设上限，但需要可控）。

### 1.4.2 Shot vs Angle（避免后续开发误解）
- **Shot**：内容单位（叙事最小单元），在时间线上排序与交付时以 Shot 为核心。
- **Angle**：制作单位（同一表演的多机位版本），用于生成 3x3 母图与切片；交付时 Angle 是 Shot 的子集资源。

---

## 2. 不可协商的产品/工程约束（防跑偏）
1) **主路径唯一**：每个镜头默认只生成 **1 张 3x3 网格母图**；切片为物理切割；九机位文本仅用于母图 Prompt 拼接。  
2) **单机位修正是“覆盖切片”**：仅在某 slot 不满意时，用该 slot Prompt 触发“单图低分辨率生成”（默认 1K），覆盖对应切片；不强制重生成母图。  
3) **强一致性校验（P0）**：进入生成队列前必须满足：Prompt 9/9 + 至少 1 角色绑定 + 至少 1 场景绑定 + 规格合法 + Key 可用 + 队列可用。  
4) **全局队列强制调度**：所有生成类调用（LLM/Image/Video）必须通过 **Main/Local-Backend** 全局队列调度（可取消/重试/超时），Renderer 不得直连第三方 Provider。  
5) **交付可追溯**：文件命名必须符合规范，ZIP 内必须包含 `manifest.json`，实现“文件 ↔ 镜头 ↔ Prompt ↔ 资产 ↔ 视频”可追溯。  
6) **存储分层**：本地优先形态下：SQLite 存元数据、文件系统存媒体（图片/视频）；前端仅缓存与展示，不作为唯一可信来源。若未来演进 Server 形态：再切换为 DB + 对象存储 + Signed URL。

---

## 2.1 开工前必须拍板的关键决策（否则高概率返工）
> 原则：允许“暂定”，但必须写清“谁决定/何时决定/默认值是什么”。否则实现会在关键点分叉（安全/交付/命名/存储）。

| 决策项 | 默认建议（本方案） | 负责人 | 状态 |
| --- | --- | --- | --- |
| 代码协作是否进入真实迭代 | **已拍板：进入**。下一步：初始化 Git 仓库；确认 `.github/CODEOWNERS` 已指向维护者（当前 `@XucroYuri`）；启用分支保护与 `Locked Files Guard` | Maintainer | 已确认 |
| aihubmix 模型 ID（TEXT/IMAGE + VIDEO=Sora-2） | **已拍板**：TEXT=`gemini-3-flash-preview`（LLM），IMAGE=`gemini-3-pro-image-preview`（母图生成），VIDEO=`sora-2`（视频生成）；实现时必须写入 `main/modelIds.ts` 并加锁定注释 | Maintainer | 已确认 |
| DB 拆分策略 | **已拍板**：默认两级 DB：`season.db` + `episode.db`（见 4.2.2） | Maintainer/PM | 已确认 |
| “纯环境镜头”豁免规则 | **已拍板**：允许 `shotKind=ENV` 豁免角色绑定，但**必须绑定场景**（见 5.1）；用于空镜/环境展示的多角度生成 | PM | 已确认 |
| 交付命名是否升级 | **已拍板**：镜头为 `Shot`（`shotId`）；机位/格子命名升级为 `Angle_{01-09}`（避免 `Shot/Angle` 语义冲突，见 5.5） | PM/Maintainer | 已确认 |
| Key 存储体验 | **已拍板**：P0 加密落盘（如 electron-store），并预留“应用激活码/授权激活”机制规划（用于约束外泄后滥用；下一阶段开发实现） | Maintainer | 已确认 |
| 本地 HTTP 是否允许作为 IPC 备选 | **已拍板**：允许；默认 IPC-first；若启用本地 HTTP，必须 127.0.0.1+随机端口+会话 token（见 4.6.1） | Maintainer | 已确认 |
| ZIP 导出是否默认包含视频 | **已拍板**：默认不包含（体积大）；导出选项拆分为“图片/视频”两类，由用户勾选是否包含 `videos/`（manifest 仍记录视频条目） | PM/Maintainer | 已确认 |
| 输出保留策略 | **已拍板（MVP）**：仅“手动清理 + 导出后可选清理 + 超配额提示”，不做自动删除（见 9.1） | PM/Maintainer | 已确认 |
| Ratio/Resolution 配置 | **已拍板**：Ratio 仅支持 `16:9` (Default) 与 `9:16`；Resolution 默认锁定 `2K`；必须在 UI 增加选择器并透传 Main | PM | 已确认 |
| 资产一致性策略 | **已拍板**：不仅角色，需覆盖道具/场景；必须在 Prompt 组装时显式注入资产描述（Subject/Wearing/Holding/Environment） | PM | 已确认 |
| UI/UX 规范 | **已拍板**：Light/Dark 双主题；字体/图标大小需符合可读性标准；配色需高对比度 | PM | 已确认 |
| 国际化 (i18n) | **已拍板**：默认简体中文 (zh-CN)；支持自动探测与 en-US 回落 | PM | 已确认 |
| 跨平台部署 (Phase 5) | **已拍板**：Win/Mac/Linux 三端一键安装（Setup Scripts）；CI/CD 自动构建产物 | PM | 已确认 |

### 2.1.1 “进入真实迭代”的含义与建议（已拍板：进入）
当你希望“规则与门禁能真实生效、并且多人协作可控”时，建议进入真实迭代；否则保持“原型试验”更省成本。

进入真实迭代（建议最低门槛）：
- **仓库形态**：使用 Git（本地 `git init`）并托管到 GitHub（或等价平台），以便启用 PR 与门禁。
- **责任边界**：在 `.github/CODEOWNERS` 填入真实维护者账号/团队，并启用分支保护（Require Code Owner Review + Require status checks）。
- **门禁落地**：启用 `.github/workflows/locked-files-guard.yml`，并约定 `maintainer-approved` 标签的使用流程（谁能打、什么时候打）。
- **协作流**：所有改动走 PR；敏感区（Provider/模型 ID/安全边界/导出与存储）必须 maintainer review；每次合入附 `dev/reference_vibe-coding-skill/templates/Change-Report.md`。

不进入真实迭代（仍可做，但风险更高）：
- 仍可继续写文档/验证原型，但“CODEOWNERS/CI 门禁”不会产生真实约束，且更容易出现密钥泄漏、模型漂移、目录分叉与不可追溯变更。

### 2.2 已拍板的实现口径（从“多选项”收敛为单一路径）
> 以下口径已经由需方拍板；实现阶段必须按此执行，避免分叉与返工。

| 决策项 | 已拍板口径 |
| --- | --- |
| 桌面容器 | 锁定 **Electron**（Tauri 不进入 MVP） |
| 并发上限 | 按能力分类型限流：`LLM=10` / `IMG=5` / `VID=3`；遇到 Provider 侧临时限流/并发超限（典型 429/5xx）时，必须做“临时自动降级并发 + 冷却期恢复”，并提示用户 |
| Beat 粒度与可编辑性 | 默认目标 `15~30` beats/episode（拆得更细优先于更粗）；必须支持“手动合并/拆分 beat” |
| 视频派生策略（默认） | 默认以 **3x3 GridMaster** 作为参考源；视频生成不自动批量跑，必须由用户手动选择 Shot/slot；为匹配 Sora-2 单参考图输入，Worker 应从 GridMaster **裁切选中 slot** 生成 `firstFrameImage`（或明确注明 slot 的 Ref Map 语义） |
| manifest 审计字段 | 默认仅写入 `buildId`（不启用 `licenseId/deviceIdHash`） |
| 离线字体策略 | 使用**系统字体**（不引入在线字体依赖；如需统一视觉再评估内置字体文件） |

---

## 3. 与其他方案的融合策略（比稿要点）
> 共识：技术路线高度一致；差异在规格细化与落地可执行度。

| 维度 | 本方案（Codex） | 偏架构规范/模块化方案 | 融合决策 |
| --- | --- | --- | --- |
| 生成策略 | 明确主路径与单机位修正规则 | 常强调技术实现但弱约束 | **以本方案业务约束为准** |
| 队列治理 | 标准状态机+错误分类+退避参数 | 强调并发控制 | **并发可配置 + 统一状态机** |
| 存储与备份 | SQLite（元数据）+ 本地文件系统（媒体）+ 导出/回落；Server 模式才用 Signed URL | 同方向，强调备份 | **补齐迁移与回落细节** |
| 交付规范 | 命名 + ZIP + manifest | 容易被忽略 | **manifest 作为交付硬标准** |
| 模块化边界 | 给出落地边界与目录建议 | 结构化更强 | **采用对方骨架，填充本方案规格** |

---

## 4. 目标架构（Desktop Local-first：高性能 + 高安全 + 前端零密钥）
> 目标：把所有“有密钥/有成本/有并发风险”的能力（LLM/Image/Video 调用、队列、持久化、导出打包）收敛到 **Electron Main/Local-Backend**；Renderer 仅负责 UI、编辑体验与安全渲染。后续如需云协作，再把 Local-Backend 等价替换为 Server API + Worker。

### 4.0 交付形态优先级（以本地三端一键运行为默认）
需求方目标：**macOS / Windows / Linux 三端本地稳定运行、绿色一键整合包、自带环境依赖与默认配置，并可在 GitHub 开源发布**。  
因此本方案的“前后端分离”按以下优先级落地：

1) **Desktop Local-first（默认/MVP）**：Renderer(UI) + Main(Local-Backend+Worker)，同机运行；密钥仅存本地安全存储；媒体落本地文件系统；SQLite 存元数据；不依赖外部 Redis/OSS。  
2) **Server（可选后续）**：公网 API + Worker + 对象存储 + 队列，用于团队协作与云资产库；与 Desktop 共享 schema/错误码/manifest。

> 关键点：无论哪种形态，**前端零密钥**不变；不同点仅在“后端运行位置”和“存储介质”。

### 4.0.1 桌面端架构图（建议对齐实现）
```mermaid
graph TD
  User[用户] --> UI[Renderer: React/Vite UI]
  UI -- IPC invoke --> Main[Main: Local Backend + Worker]
  Main --> DB[SQLite: season.db + episode.db]
  Main --> FS[Local FS: workspace output/]
  Main --> Q[In-memory Queue + SQLite tasks]
  Q --> Provider[AI Provider: aihubmix (text+image + video=sora-2)]
  Main --> Export[ZIP Export + manifest]
  KeyStore[OS Keychain / Encrypted Store] -.-> Main
```

### 4.1 推荐进程边界（Desktop MVP）
- **Renderer（前端/UI）**：镜头工作台（编辑、预览、交付、任务状态展示）；通过 IPC 调用 Main；不直接调用第三方 Provider。
- **Main（本地后端）**：Episode/Scene/Beat/Shot/Angle/Asset/Task 的 CRUD、校验（GenerationPolicy）、队列编排、导出（ZIP+manifest）、安全存储（key）。
- **Worker（本地任务执行器）**：可作为 Main 内模块或独立进程；执行 Provider 调用、写入媒体文件、回写进度与结果。

### 4.2 vNext 工程目录结构（强制前后端分离，重构后以此为准）
> 目的：让“前后端分离（Renderer/Main）”通过**目录结构**强制落地，降低职责混淆与密钥泄漏风险。

源码目录（Repo Root，权威）：
```text
main/                  # Electron Main + Local-Backend + Worker（唯一允许触达 Key/FS/DB/Provider）
renderer/              # React/Vite UI（严格 Browser-only；禁止触达 Key/Provider/FS/DB）
shared/                # 共享：types/schema/error-codes/manifest（必须纯 TS；禁止 Node/Electron 依赖）
dev/                   # 方案/评审/过程文档
.github/               # CODEOWNERS + locked-files-guard 等门禁
tmp/                   # 本地临时文件目录（仅开发/调试用；必须加入 .gitignore，不入库）
```

强制规则（用目录强制“前后端分离”）：
- **Renderer 禁止**：引入任何 Provider SDK/适配层；禁止读取 `.env`/`process.env`；禁止读写本地文件系统与数据库。
- **Main 必须**：集中承载 Provider 调用、任务队列、落盘、导出打包、Schema 校验与错误码映射。
- **Shared 必须**：只放双方都需要且可被浏览器执行的内容（类型、schema、常量、错误码）；禁止 `fs`/`path`/`electron` 等依赖。

说明（避免歧义）：
- “生成结果聚合目录”指 **Workspace** 下的 `{WorkspaceRoot}/OmniDirector/output/`（见 4.2.1），不是 repo 根目录。

可选演进（非 MVP 强制；需要时再演进为 monorepo）：
```text
apps/
  desktop/             # Electron 主进程 + Worker（本地后端）
  renderer/            # React/Vite 前端 UI
packages/
  shared/              # 共享类型、错误码、manifest schema（Renderer/Main 一致）
infra/
  ci/                  # GitHub Actions / Release 配置
  signing/             # 签名说明（可选）
```

### 4.2.1 本地工作区目录结构（强烈建议采用，便于交付与可追溯）
> 重点新增：把“生成结果（图片/视频/manifest/ZIP）”统一聚合到 `output/` 下分类保存，便于用户查找与交付；把“工作数据（DB/脚本/资产引用）”放在 `data/` 下，避免混杂。

```text
{WorkspaceRoot}/OmniDirector/
├── data/                              # 工作数据（内部使用，UI 通过 Main 访问）
│   └── {ProjectName}/
│       └── season_{SeasonNo}/
│           ├── season.db              # Season 级：资产库、Episode 索引、全局任务
│           ├── assets/                # Season 共享资产（角色/场景/道具 refs）
│           └── episodes/
│               └── {EpisodeID}/
│                   ├── episode.db     # Episode 级：Script/Scene/Beat/Shot/Angle/历史
│                   └── script.txt
└── output/                            # 生成结果（用户可见的“交付与素材”入口）
    └── {ProjectName}/
        └── season_{SeasonNo}/
            └── episodes/
                └── {EpisodeID}/
                    ├── shots/
                    │   └── {ShotID}/
                    │       └── grid_{GridID}/
                    │           ├── {EpisodeID}_{SceneID}_{GridID}_GridMaster.png
                    │           ├── {EpisodeID}_{SceneID}_{GridID}_Angle_{01-09}.png  # Angle slot
                    │           └── manifest.json
                    ├── videos/        # 视频输出（按 shot/grid/slot/revision 分层）
                    │   └── {ShotID}/
                    │       └── grid_{GridID}/
                    │           └── slot_{01-09}/
                    │               └── {EpisodeID}_{SceneID}_{GridID}_Angle_{01-09}_v0001.mp4
                    └── exports/       # ZIP 导出（聚合在 output 下，便于用户直接拿走）
```

约束：
- WorkspaceRoot 默认 `~/Documents`，但必须允许用户自定义（便于团队共享盘/同步盘）。
- `season.db` 作为 Season 级权威索引与资产库；`episode.db` 作为 Episode 级作业库。
- `beatId` 写入 `episode.db`，并由 `manifest.json` 关联（避免文件名过长）。
- 生成文件（母图/切片/视频/manifest/ZIP）**只允许**由 Main/Worker 写入 `output/`（Renderer 仅展示与触发任务）。
- DB 仅保存元数据与文件指针；不得把大图 Base64 作为唯一持久化来源。

### 4.2.2 已拍板：DB 拆分策略（两级 DB：Season + Episode）
需求方反馈倾向“拆开比较好”，用于保存不同性质的数据。为避免过度设计，同时满足可移植与资产复用，本方案建议采用 **两级 DB**：

- `season.db`（Season 级共享/索引）
  - Season 资产库（角色/场景/道具）与 ref 文件路径
  - Episode 列表与元信息（episodeId、集号、名称、更新时间）
  - 全局任务表（TaskQueue 持久化），便于跨 Episode 恢复队列
- `episode.db`（Episode 级作业）
  - Script 原文、Scene/Beat/Shot/Angle 结构化数据
  - Shot 的 GridRender/slotRevision 历史记录
  - Episode 级新增/覆盖资产的引用关系（可选）

优点：
- 拷贝/分享一个 Episode 的“数据 + 产出”即可携带该集全部作业（`data/.../episodes/{EpisodeID}` + `output/.../episodes/{EpisodeID}`），符合本地应用习惯与交付习惯。
- Season 资产库可跨 Episode 复用，不用每集重复拷贝大 ref。

备选（更简化）：
- 全部写入单个 `season.db`（以 `episode_id` 分区）；Episode 目录仅存媒体与 manifest。若后续遇到迁移/共享诉求，再拆分 DB。

### 4.3 本地后端核心组件（高性能/高安全的关键）
- **Auth & Tenant**：Desktop MVP 默认单用户/单租户；若未来演进团队协作/多用户，再引入更强的隔离与权限边界（不要在 MVP 预埋重系统）。
- **Metadata DB**：SQLite（本地单文件），存：IP/Project/Season/Episode/Scene/Beat/Shot/Angle/Asset/Task/Manifest 元数据。
- **资产作用域（行业分层落地）**：Season 级资产为默认资产库（跨 Episode 复用）；Episode 级仅保存“新增/覆盖/引用关系”，避免每集重复拷贝大资产。
- **Queue**：`p-queue`/自研轻队列（In-Memory）+ SQLite tasks 表（持久化与恢复）；并发上限按能力分类型限流：`LLM=10` / `IMG=5` / `VID=3`，并支持在 Provider 侧临时限流/并发超限时做“自动降级并发 + 冷却期恢复”。
- **Media Storage**：本地文件系统（默认写入 Workspace 的 `output/`，见 4.2.1）；导出 ZIP 作为标准交付（替代对象存储）。
- **Provider Adapter**：统一封装 aihubmix（文本/图片 + 视频=`sora-2`）；做参数归一化、错误码映射、审计日志与速率限制。
- **Progress 通知**：IPC push（或 event emitter）把 task 状态推给 Renderer；也支持轮询 fallback。

### 4.4 Provider 选择逻辑（必须在 Main/Local-Backend 执行）
> 原则：**aihubmix 是唯一 Provider Source**；允许使用不同兼容端点，但**只允许打到 aihubmix**；**任何 key 不进入前端 bundle、URL、日志明文、持久化存储**。

推荐（按能力拆端点，但来源仍唯一）：
```text
if (AIHUBMIX_API_KEY 有效):
  geminiBaseUrl = https://aihubmix.com/gemini   # 文本/图片（Gemini 兼容）
  openaiBaseUrl = https://aihubmix.com/v1      # 视频（OpenAI 兼容，如 sora-2）
else:
  阻断：提示用户/管理员配置 AIHUBMIX_API_KEY（本产品不直连任何官方 API）
```

### 4.4.0 vFuture 预留：多 API 服务商（主备切换）演进原则（当前版本不启用）
> 目的：为未来可能引入新的 API 服务商预留“清晰边界与可演进实现位”，但不破坏当前版本的硬红线（aihubmix-only）。

当前版本硬约束（MVP）：
- **只允许 aihubmix**：不得引入第二服务商的真实调用实现，不做自动主备切换、不做 Provider fallback（否则会破坏可追溯与一致性）。
- 预留仅限“代码结构的 seam（接口/目录/数据字段）”，不改变运行时行为。

未来版本（vFuture）若要开启多服务商与主备切换，必须满足：
- **更新 `rules.md` 与 `dev/Guardrails.md`**（解除 aihubmix-only 红线并新增门禁/验收用例）。
- **维护者批准**：涉及 Provider 选择/路由/回退策略属于“成本/安全/一致性”高风险变更，必须 maintainer-approved。
- **全链路可追溯**：每个产物（grid/video）必须记录 `providerId/baseUrl/modelId`，以便复盘与对账（见 5.6）。

### 4.4.3 vFuture Provider 抽象与路由（建议结构，便于后续扩展）
> 目标：把“服务商差异”封装在 Main 内部，Renderer 永远不知道“有几个 Provider”，只认任务与错误码。

建议模块（Main 内部）：
- `main/providers/`：各服务商适配层（一个子目录一个 providerId）
- `main/providerRegistry.ts`：注册表（可用 provider 列表 + capabilities）
- `main/providerRouter.ts`：路由策略（按 capability 选 primary；按策略决定是否 failover）
- `main/providerConfig.ts`：配置与开关（锁定文件；见 Guardrails）

建议核心数据结构（示意）：
```ts
type Capability = "text" | "image" | "video";
type ProviderId = "aihubmix" | "future-provider";

type ProviderEndpointKind = "gemini" | "openai";

type ProviderConfig = {
  providerId: ProviderId;
  enabled: boolean;
  priority: number; // 越小越优先（primary=0）
  endpointKind: ProviderEndpointKind;
  baseUrl: string;
  apiKeyRef: "AIHUBMIX_API_KEY" | "OTHER_API_KEY";
  capabilities: Capability[];
};
```

主备切换策略（建议）：
- **默认禁用自动切换**：Creative 生成（image/video）强依赖一致性，自动切换会导致风格漂移与不可复现；默认只允许“同 provider 重试”。
- **允许的切换条件（vFuture 才能启用）**：
  - 仅对可重试错误（429/5xx/网络）在重试阶段触发；
  - 每个 Task 在入队时“冻结 providerId + modelId”，并写入 tasks 表与 manifest（允许手动 rerun 选择其他 provider，但必须生成新 revision 并可追溯）。

### 4.4.4 vFuture 主备切换的验收口径（预埋 DoD）
- 不开启时：所有任务的 `providerId` 必须固定为 `aihubmix`，且无任何 fallback 行为。
- 开启后：每次切换必须产生审计日志与 manifest 记录；UI 必须清晰展示“使用了哪个 Provider/Model”与切换原因。

### 4.4.1 模型 ID 锁定（强制注释 + 仅允许人工修改）
> 需求方要求：在 aihubmix 中调用的 **LLM / 绘图 / 视频**模型 ID 必须通过注释“锁定”，防止任何 LLM/Agent 依据旧知识擅自改动。该部分**只允许项目维护者人工修改**。

建议工程约束（下一阶段实施）：
- 将模型 ID 集中在一个文件（例如 `src/constants/modelIds.ts` 或 `main/modelIds.ts`）。
- 在每个模型常量上方写“锁定注释”（建议与 `rules.md` 一致：`MODEL ID LOCKED - ONLY MAINTAINER CAN CHANGE`），并在 code review 规则中要求任何变更必须由维护者手动提交。
- `MODEL ID` 只出现在一处，其他模块只引用常量，不允许写死字符串。

模型 ID（已拍板，必须锁定；来源以 aihubmix 模型页为准）：
| 能力 | 常量名 | aihubmix 模型 ID（锁定） |
| --- | --- | --- |
| Script/Segment/Matrix LLM | `AIHUBMIX_TEXT_MODEL` | `gemini-3-flash-preview` |
| 3x3 母图生成 | `AIHUBMIX_IMAGE_MODEL` | `gemini-3-pro-image-preview` |
| 视频生成（锁定：仅 Sora-2） | `AIHUBMIX_VIDEO_MODEL` | `sora-2` |

### 4.4.2 视频模型红线（仅允许 aihubmix 的 Sora-2）
需求方要求：**仅允许适配 aihubmix 的 Sora-2（模型 ID：`sora-2`）进行视频生成**，当前版本禁止接入其他视频模型（包括 Veo 等），并必须进行“注释锁定”。

- 规则：
  - 视频生成能力只允许走 `AIHUBMIX_VIDEO_MODEL = sora-2`。
  - 任何新增/替换视频模型的行为都属于“重大变更”，必须由维护者本人提交并更新文档与验收用例。
- 影响面（实现阶段注意）：
- 现有原型中若存在 Veo 相关 UI/逻辑，应在 Desktop MVP 中隐藏/禁用或替换为 Sora-2（以避免误触发非允许模型）。

#### 4.4.2.1 Sora-2（aihubmix）接口与参数要点（来源：aihubmix 文档）
> 参考资料：
> - https://aihubmix.com/model/sora-2
> - OpenAI Video Generation Guide（仅供理解参数/语义；**实际调用必须指向 aihubmix 端点**）：https://platform.openai.com/docs/guides/video-generation#page-top

调用形态（OpenAI 兼容端点）：
- `base_url`: `https://aihubmix.com/v1`
- `model`: `sora-2`
- 典型流程：`videos.create` → 轮询 `videos.retrieve`（`queued`/`in_progress`→`completed`/`failed`，可选 `progress`）→ `videos.download_content`

参数（按当前资料整理；实现阶段以 aihubmix 返回为准做兼容）：
- `prompt`：自然语言描述镜头；建议“单一内容、单一意图”，包含镜头类型/主体/动作/场景/光线/镜头运动，避免多主题堆叠。
- `size`（宽×高）：支持 `720x1280`（默认，9:16）与 `1280x720`（16:9），与本项目画幅白名单一致（见 5.3.1）。
- `duration`：支持 `4s`（默认）、`8s`、`12s`。
- `image`（可选参考图，作为第一帧引导）：支持 `image/jpeg`、`image/png`、`image/webp`。

Ref 语义要求（实现必须遵守）：
- Sora-2 当前按“单参考图”工作：若传 `image`，必须在文本 prompt 中写清楚“该图的作用”（首帧构图/主体位置/身份一致性）；并确保输入图对应用户选择的 shot/slot（不得隐式猜测）。
- 已拍板的视频默认策略：以 **GridMaster** 作为参考源；但为匹配单参考图输入并降低歧义，Worker 默认应从 GridMaster **裁切出选中 slot 的单图**作为 `image/firstFrameImage` 送入模型，并在 Ref Semantics 中注明“该图来自 GridMaster 的 slot_{01-09}，用途=首帧构图/主体位置/一致性”。
- 如因调试/兼容原因必须直接传 3x3 GridMaster，则必须在 Ref Semantics 中明确“使用哪个 slot 作为首帧意图”，并在 UI 中要求用户显式选择 slot（不得隐式猜测）。

### 4.5 前端安全与性能策略（需要前端配合）
- **前端零密钥**：所有生成请求只发给 Main/Local-Backend；媒体通过本地路径/自定义协议（如 `omnidir://`）读取；前端不拼接任何 key。
- **媒体处理**：避免 Base64；图片/视频以 URL + range 请求展示；必要时对大图做缩略图与懒加载。
- **离线策略**：默认离线可用（本地存储）；生成类任务在无网络时排队或提示暂停。

### 4.5.1 生成请求的 Prompt 组装（强制顺序 + Ref 语义说明）
> 目标：确保“Preset/一致性约束/参考图语义”在每次真实调用时都被**强制前置注入**，避免 UI 里看起来配置了但请求里没带上。

图片母图生成（3x3）请求组装顺序（Main/Worker 权威）：
1) **Image Style Preset**：作为顶层字段（或作为最终 prompt 的前缀段落）强制注入。
2) **Consistency Locks**：Identity/Environment/Prop Lock Prompt（来自资产库与用户锁定文本），强制注入。
3) **Asset Ref Semantics（必须）**：对每张参考图附带一段“它用于什么约束”的文字说明；要求按资产分类明确标识，并能对账到文件名：
   - **角色资产（CHAR）**：必须写明 `[角色名] ↔ [参考图文件名]`，并明确“保持角色一致性”（脸/发型/服装关键特征不跑偏）。
   - **场景资产（SCENE）**：场景相关文字处必须标注 `[参考：场景图片文件名]`（或等价语义），说明用于对齐空间布局/光线/色彩基调，并明确“保持场景一致性”。
   - **道具资产（PROP）**：必须写明 `[参考图：道具图片文件名]`，并说明用于锁定形状/材质/尺度/摆放关系，并明确“保持道具一致性”。
   - 若模型支持多参考图输入：每张图都必须有独立语义说明；若只支持单图但需要多主体：必须使用“拼图 + Ref Map”，并说明每个格子的含义与映射。
4) **Angles[9]（Style-free）**：仅包含同一 Shot 下 9 个机位差异与内容描述；不得重复堆叠风格词。

视频生成（Sora-2 / `sora-2`）请求组装顺序（Main/Worker 权威）：
1) **Video Style Preset**：必须前置注入到视频 prompt 的最前面（或作为 system/prefix 段落）。
2) **Consistency Locks**：同上（尤其是角色身份锁定，避免跨镜头漂移）。
3) **Ref 语义（单参考图，必须）**：Sora-2 当前按“单张参考图=第一帧引导”理解；若传 `image` 必须在文本 prompt 中明确说明该图的用途，至少覆盖下列两类场景之一：
   - **基于分镜结果生成视频**：当输入图是 3x3 母图或某个切片时，说明“该图用于第一帧构图/主体位置/光线参考”，并说明要生成哪一个机位/slot 的视频（推荐：传入对应 slot 切片作为首帧；若传 3x3 母图，必须说明使用哪个格子作为首帧意图）。
   - **基于角色资产图保持一致性**：当输入图是角色资产参考图时，必须写明 `[角色名] ↔ [参考图文件名]`，说明“该图用于锁定角色身份一致性”，并在视频 prompt 中保持与该角色一致的描述。
4) **Video Prompt（主体语种为主）**：主体描述必须使用 `scriptLanguage`（默认中文），仅镜头术语/参数可用英文；必须以 `shot.originalText` 为事实底座进行影视化视觉转译。

### 4.6 IPC/API 合约草案（便于对齐 Renderer/Main）
> Desktop MVP 推荐：IPC `invoke`（类型安全即可，不强制 tRPC）。以下以“资源/动词”描述能力边界，具体实现可映射为 IPC channel 或本地 HTTP。

- **Hierarchy（行业分层）**
  - `GET/POST /api/ip`
  - `GET/POST /api/projects`
  - `GET/POST /api/seasons`
  - `GET/POST /api/episodes`
- **Assets（资产库，按作用域）**
  - `GET/POST /api/seasons/:seasonId/assets`（Season 级共享资产库）
  - `GET/POST /api/episodes/:episodeId/assets`（Episode 级新增/覆盖资产，可选）
- **Episode 工作流**
  - `POST /api/episodes/:episodeId/segment`（脚本→scene/beat 切分）
  - `POST /api/episodes/:episodeId/breakdown`（scene/beat→shots，带原文锚点）
  - `POST /api/shots/:shotId/matrix-prompts`（生成 9 个 angle prompts）
  - `POST /api/shots/:shotId/render-grid`（生成母图 + 9 angles 切片入队）
  - `POST /api/shots/:shotId/render-angle`（单 angle 修正入队）
  - `POST /api/shots/:shotId/render-video`（视频任务入队：模型固定 `sora-2`；可选 `size`/`durationSeconds`/`firstFrameImage`）
  - `GET /api/tasks/:taskId` / `GET /api/tasks/stream`（状态查询/推送）
- **交付**
  - `POST /api/episodes/:episodeId/export`（生成 ZIP，返回本地文件路径/句柄；可选一键打开目录）

### 4.6.1 通信与媒体访问安全门禁（P0，防“看起来分离但实际没分离”）
> 目标：避免实现阶段因为“省事”回退到前端直连、`file://` 乱读、或本地 HTTP 暴露过宽，最终破坏 Zero-Secret 与前后端边界。

- **IPC First**：Desktop MVP 默认只允许 IPC（`ipcRenderer.invoke` + push/stream）；本地 HTTP 仅作为备选方案。
- **若启用本地 HTTP（备选）**：必须绑定 `127.0.0.1`；使用随机端口；每次启动生成会话 token；所有写操作必须校验 token（防止被本机其他进程/网页探测与调用）。
- **媒体访问策略**：Renderer 不直接拼绝对路径、不直接开放任意 `file://`；优先使用自定义协议（如 `omnidir://`）或“受控读取 API”（Main 校验路径白名单后返回可展示 URL/Buffer）。
- **工程门禁（建议实现）**：CI/lint 增加规则：`renderer/` 内禁止依赖 Provider SDK/适配层（例如 `@google/genai`、`main/providers/**` 等），防止回归前端直连。
- **Electron 安全配置（必须遵守 `rules.md`）**：开启 `contextIsolation`，保持 `nodeIntegration=false`；preload 仅暴露白名单 API，禁止暴露任意 Node 能力与“万能 IPC 通道”。

### 4.7 团队配合点（Desktop MVP）
- Main/Local-Backend 需要前端配合：统一错误码/状态机展示（与本文件 5.x 对齐）、任务中心 UI、媒体访问策略（本地路径/自定义协议，避免直接暴露绝对路径到渲染层可选）。
- 前端需要后端配合：提供稳定 schema（zod/json schema）、manifest 与命名规则由后端生成并下发（前端只展示）。
- DevOps 需要配合（最小化）：GitHub Actions 三端构建、签名策略（可选）、Secrets 管理（仅 CI）、日志脱敏。

### 4.8 桌面端一键运行（建议技术路线：Electron 或 Tauri）
> 目标：用户双击即可运行，无需自行安装 Node/Python/Redis；支持打包与 GitHub Release 分发；尽量避免“过度设计”。

**推荐优先：Electron（落地快、生态成熟）**
- 现有项目是 React/Vite，迁移成本最低；可打包出 `dmg` / `exe`（portable/installer）/ `AppImage`。
- 将“后端 API + Worker”做成 **Electron Main Process 内的本地服务/模块**（优先 IPC `invoke`；本地 HTTP 为备选），不引入外部服务依赖。
- 本地存储：SQLite（元数据）+ 文件系统（媒体），无需对象存储；对外导出 ZIP 即可完成交付。

**备选：Tauri（更小体积，但工程门槛更高）**
- 适合后续优化体积/性能，但引入 Rust 工具链与跨平台调试成本；不建议作为第一版交付路径。

**桌面端落地要点（与 Plan-Codex 对齐）**
- 密钥管理：只在本地；**交付产物不包含任何 API KEY**。应用首次运行/密钥缺失/密钥不可用时，必须阻断生成主流程并弹窗引导配置 Key（Renderer 不接触 key，配置与校验均在 Main 完成）。
- 加密持久化：输入的 API KEY 必须加密永久化存储（默认 `electron-store` + AES-GCM）；加密所需的主密钥应优先存放在 OS Keychain（macOS Keychain / Windows Credential Manager / Linux Secret Service；实现可用 `keytar`），避免“拷贝数据目录即可复用”。
- 设备绑定与自动失效：Key 的可用性必须与当前设备/安装实例绑定；若检测到设备变化（无法从 Keychain 取回主密钥、或设备指纹/安装实例不一致），必须将本地密钥标记为失效并销毁（清空密文与缓存），要求重新输入。
- Key 供给方式（产品侧约束源头）：推荐由产品方为每个授权用户/设备发放独立的 aihubmix Key（可吊销/可轮换），减少外泄后的滥用面；UI 在 Key 输入框下方提示“Key 由产品方提供/绑定授权”。
- 授权/激活（下一阶段实现，已预留）：为进一步降低软件外泄后的滥用，规划“激活码/授权激活”机制：激活态作为“允许写入/使用本地加密 Key”的前置条件；激活信息独立加密存储并与设备/安装实例绑定；支持可吊销/过期策略。
- 任务队列：建议 `p-queue`（In-Memory）+ SQLite tasks（持久化）实现可恢复；并发上限按能力分类型限流：`LLM=10` / `IMG=5` / `VID=3`，并在 Provider 侧临时限流/并发超限时支持“自动降级并发 + 冷却期恢复”（避免因服务商策略临时调整导致全链路不可用）。
- 媒体存储：默认落到 Workspace 的 `output/`（对用户可见、可交付）；可使用 `{appData}` 做内部缓存，但不得替代 output 的交付口径。

### 4.8.1 迁移路线图（吸收 Standalone 方案的可落地拆分）
> 该路线图只描述“桌面化与本地化”工程路径；业务规格（Scene/Beat、GenerationPolicy、命名/manifest/ZIP）仍以本方案第 5 章为准。

- Phase 0：目录与壳层约定（先定“真实目录结构”，避免后续返工）
  - 约定目录（建议）：
    - `main/`：Electron Main / Local-Backend（唯一允许触达 Provider Key 与外部 API）
    - `main/preload.ts`：preload（只暴露最小 IPC API，禁止暴露任意 Node 能力给 Renderer）
    - `renderer/`：React/Vite UI（迁移现有代码到这里，Renderer 禁止触达任何 Provider Key）
  - 约定运行时目录（与 4.2.1 对齐）：`{WorkspaceRoot}/OmniDirector/data`（DB/脚本/资产）+ `{WorkspaceRoot}/OmniDirector/output`（生成结果聚合）

- Phase 1：Electron 壳与开发体验（约 2 天）
  - Electron + Vite + React 基础模板
  - 依赖建议：`electron`、`electron-builder`、`concurrently`（或等价脚本）
  - 依赖分层：运行时依赖（Main 会调用且需随包）放 `dependencies`；构建/开发工具放 `devDependencies`（避免生产环境缺包）
  - Main/Renderer 双进程调试（VSCode）
  - IPC 基础封装（`ipcRenderer.invoke` + 类型定义）
  - electron-builder 基础配置（能打包出 dev 产物）
- Phase 2：数据层本地化（约 3 天）
  - SQLite 接入（建议 Drizzle + better-sqlite3 或 sqlite3）
  - 文件系统封装（媒体库目录、读写、清理、导出目录）
  - 资产 ref 从 Base64 迁移为文件路径/Blob（仅规划，代码下一阶段做）
- Phase 3：业务逻辑迁移（约 4 天）
- 将 Provider 调用迁移到 Main（aihubmix：文本/图片 + 视频=`sora-2`）
  - 落地 TaskQueue（p-queue + tasks 表恢复）
  - 落地“母图→切片→命名→manifest→ZIP 导出”全链路
- Phase 4：UI 信息架构与可维护性（约 1-2 天）
  - 引入路由（推荐 `HashRouter`）：`Home`（Season/Episode 列表）→ `Workspace`（编辑器/任务中心/图库）
  - 拆解 `App.tsx`（避免 God Component）：将 Episode 工作台状态下沉到模块 Store（可从 Context 起步，必要时再上 Zustand）
  - 长列表性能：Beat/Shot/任务/图库默认虚拟滚动与懒加载（与第 8 章 P1 任务呼应）

### 4.8.2 “生产构建离线可用”硬约束（开源/绿色包关键）
- 生产构建不得依赖 CDN：Tailwind、字体、importmap 依赖需本地化（否则离线即白屏）。
- 开源发布不得要求用户配置复杂环境：`git clone` 后只需 Node + npm 即可开发；Release 用户无需安装任何依赖。

---

## 4.9 开源与发布（GitHub Ready）
> 目标：仓库可直接开源，任何人 clone 后可运行；Release 提供三端整合包。

- **依赖本地化**：生产构建不得依赖 CDN（当前 `index.html` 里的 Tailwind CDN / importmap 属于“必须移除”的技术债），确保离线可运行。
- **Secrets 零入库**：仓库内只提供 `.env.example`；CI 不回显密钥；日志脱敏；严禁把 key 拼到 URL。
- **Release 工程化**：
  - GitHub Actions matrix（macOS/Windows/Linux）构建产物并发布到 Releases。
  - 产物形态建议：macOS `dmg`，Windows `portable.exe` 或 `zip`，Linux `AppImage`（兼顾“绿色包”与易用性）。

### 4.9.1 必要的软件安全机制锁（反仿造/反滥用：务实版）
> 现实边界：桌面客户端属于“可被逆向的终端”，**无法**靠纯客户端技术做到“绝对防破解/防仿造”。本项目的目标是：
> 1) 保护密钥与成本（Zero-Secret + 设备绑定 + 可吊销）；2) 提升篡改/仿造成本（签名/完整性/水印）；3) 让滥用可追溯（审计与输出标识）。

建议的最小组合（与本方案已拍板的 Key/激活规划一致）：
- **发布可信（P0）**：三端产物必须代码签名（macOS Hardened Runtime + Notarization；Windows Authenticode；Linux 提供校验签名/哈希），并在官网/Release 页面提供校验信息。
- **更新可信（P0）**：若启用自动更新，更新包必须签名并校验；拒绝来源不明或签名不合法的更新（防供应链替换）。
- **激活/授权（P1）**：引入“激活码/授权激活”作为**允许写入/使用本地加密 Key**的前置条件；激活令牌需可吊销/可过期，并与设备/安装实例绑定（避免拷贝数据目录复用）。
- **设备绑定 Key（P0/P1）**：以 OS Keychain/凭据库作为根（取不回即视为设备变化），并在设备变化时自动销毁本地 Key（已在 4.8 约束）。
- **输出可追溯（P1）**：默认在 `manifest.json` 写入 `buildId`；`licenseId/deviceIdHash` 保持关闭（如未来启用必须走隐私与合规评审），并可选在导出 ZIP 里带 `audit.json`；用于对账与追责（不影响离线使用）。
- **品牌与法律（P0）**：开源并不等于允许“冒充官方版本”。建议明确商标/品牌使用规范（例如 `TRADEMARK.md`），并在 UI/导出 manifest 中标注发行方与 buildId。

---

## 5. 执行规格包（让实现“可直接开工”）
> 本章节所有规则以 **Main/Local-Backend** 实现为准（权威来源），Renderer 仅做镜像提示与交互引导；避免出现“前端通过但后端拒绝/或相反”的不一致。

### 5.1 GenerationPolicy（P0 生成前置校验）
| 校验项 | 规则 | 失败错误码 | UI 提示 | 一键修复建议 |
| --- | --- | --- | --- | --- |
| Prompt 完整性 | 9/9 且非空 | `POLICY_VIOLATION` | 标红缺失 slot | 一键“生成矩阵 Prompt” |
| 角色绑定 | 默认 `linkedCharacters >= 1`；若 `shotKind=ENV` 或用户手动标记“纯环境镜头”，则允许豁免 | `POLICY_VIOLATION` | 提示绑定角色/或确认豁免 | 一键绑定角色 / 一键标记 ENV |
| 场景绑定 | `linkedScenes >= 1` | `POLICY_VIOLATION` | 提示绑定场景 | 跳转场景库并高亮 |
| 规格合法 | `aspectRatio ∈ {16:9, 9:16}` 且 `resolution ∈ {1K, 2K, 4K}`（**禁止新增其他画幅**） | `POLICY_VIOLATION` | 提示非法规格 | 自动回退默认值 |
| 队列可用 | 无同 shot 冲突任务 | `POLICY_VIOLATION` | 提示任务冲突 | 打开任务中心定位 |
| Key 可用 | provider key 已就绪（缺失/不可用必须阻断） | `AUTH_REQUIRED` | 引导配置 Key（首次运行/Key 缺失/测试失败时弹窗） | 打开 Key Picker |

### 5.2 任务队列状态机（UI/存储/日志统一）
| 状态 | 含义 | 允许转移到 | 说明 |
| --- | --- | --- | --- |
| `queued` | 排队中 | `running`, `cancelled` | 等待调度 |
| `running` | 执行中 | `succeeded`, `failed`, `cancelled` | 可选进度（估算/阶段性） |
| `succeeded` | 成功 | - | 写入媒体与元数据 |
| `failed` | 失败 | `queued`（重试） | 存失败原因与分类 |
| `cancelled` | 取消 | - | 不产生媒体副作用 |

### 5.3 重试/超时/退避参数（默认建议）
| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `concurrencyCaps.llm` | 10 | LLM 任务并发上限（按能力分池） |
| `concurrencyCaps.image` | 5 | 图片任务并发上限（按能力分池） |
| `concurrencyCaps.video` | 3 | 视频任务并发上限（按能力分池） |
| `concurrencyAutoDegrade.enabled` | true | 触发条件见 5.4；在 Provider 侧临时限流/并发超限时降级并发 |
| `concurrencyAutoDegrade.cooldownMs` | 600000 | 降级后冷却期（10min），冷却期结束后尝试逐步恢复 |
| `maxRetries` | 3 | 仅对可重试错误（429/5xx/网络） |
| `baseDelayMs` | 800 | 指数退避起点 |
| `maxDelayMs` | 10000 | 退避上限 |
| `jitter` | true | 避免并发雪崩 |
| `taskTimeoutMs.image` | 300000 | 图片任务超时（5min） |
| `taskTimeoutMs.video` | 1200000 | 视频任务超时（20min） |
| `pollIntervalMs.video` | 10000 | 视频轮询间隔 |

### 5.3.1 画幅白名单（硬约束）
> 需求方明确：图像与视频的画幅只需要 `16:9` 与 `9:16`，后续开发过程中**禁止主观添加**其他比例画幅。

- 白名单：`{16:9, 9:16}`
- 适用范围：母图生成（图片模型）与视频生成（Sora-2 / `sora-2`）
- UI 行为：规格选择仅显示两项；导入旧数据/第三方数据若包含其他画幅，必须在 Main 侧拒绝并给出修复建议（回退默认/提示重设）

实现提示（视频=Sora-2）：
- Sora-2 当前资料支持 `720x1280`（9:16）与 `1280x720`（16:9）；建议把 `aspectRatio` 映射到 `size`，避免额外比例造成失败或变形。

### 5.4 错误分类（结构化口径）
| errorCode | 可重试 | 常见原因 | UI 处理 |
| --- | --- | --- | --- |
| `AUTH_REQUIRED` | 否 | Key 未配置/失效 | 引导配置 Key |
| `QUOTA_EXCEEDED` | 是 | 429/配额耗尽 | 降分辨率/稍后重试 |
| `PROVIDER_RATE_LIMIT` | 是 | 429/并发或速率临时收紧 | 自动退避重试；触发“并发临时自动降级”；提示稍后恢复 |
| `PROVIDER_5XX` | 是 | 服务端异常 | 自动重试后提示 |
| `NETWORK_ERROR` | 是 | 网络中断/超时 | 自动重试/提示网络 |
| `POLICY_VIOLATION` | 否 | 前置校验失败 | 缺项清单 + 一键修复 |
| `UNKNOWN` | 视情况 | 未分类异常 | 提示反馈并记录日志 |

### 5.5 命名规范（交付硬约束）
- 母图：`{EpisodeID}_{SceneID}_{GridID}_GridMaster.png`  
- 切片（Angle）：`{EpisodeID}_{SceneID}_{GridID}_Angle_{01-09}.png`（`Angle_{01-09}` 表示固定 1-9 的机位 slot；Beat 通过 `manifest.json` 关联，不强制进文件名以避免过长）

**ID 定义**：
- `EpisodeID`：集（Episode）唯一标识（UUID/短 hash）。  
- `SceneID`：场景标识（优先从 `contextTag`/INT-EXT 归一化；回退 `Sc01/Sc02...`）。  
- `GridID`：母图生成版本号（同一镜头每次重生成母图递增）。  
- `Angle_{01-09}`：slot 序号（固定 1-9），不是镜头号。

**AngleSlot→机位映射**：
| AngleSlot | 标签 | 含义 |
| --- | --- | --- |
| 01 | EST | 远景 |
| 02 | OTS | 过肩 |
| 03 | CU | 特写 |
| 04 | MS | 中景 |
| 05 | LOW | 仰拍 |
| 06 | HI | 俯拍 |
| 07 | SIDE | 侧拍 |
| 08 | ECU | 极特写 |
| 09 | DUTCH | 荷兰斜角 |

### 5.6 manifest.json（ZIP 内必带）
> 目的：对账与追溯；让“文件名 ↔ 镜头 ↔ Prompt ↔ 资产 ↔ 视频”可还原。
```json
{
  "ipId": "ip_marvel",
  "projectId": "proj_xxx",
  "seasonId": "S01",
  "episodeId": "E_9f2a",
  "scriptLanguage": "zh-CN",
  "promptLanguage": "zh-CN",
  "sceneId": "Sc01",
  "beatId": "Bt03",
  "shotId": "sh_0012",
  "gridId": 3,
  "params": { "aspectRatio": "16:9", "resolution": "2K" },
  "provider": {
    "providerId": "aihubmix",
    "endpointKind": "gemini",
    "baseUrl": "https://aihubmix.com/gemini",
    "model": "gemini-3-pro-image-preview"
  },
	  "gridMaster": "E_9f2a_Sc01_3_GridMaster.png",
	  "slots": [
	    {
	      "slot": 1,
	      "camera": "EST",
	      "file": "E_9f2a_Sc01_3_Angle_01.png",
	      "prompt": "...",
	      "provider": { "providerId": "aihubmix", "endpointKind": "gemini", "baseUrl": "https://aihubmix.com/gemini", "model": "gemini-3-pro-image-preview" }
	    }
	  ],
  "linkedAssets": {
    "characters": ["ast-..."],
    "scenes": ["ast-..."],
    "props": ["ast-..."]
  },
	  "derivedVideos": [
	    {
	      "slot": 1,
	      "file": "E_9f2a_Sc01_3_Angle_01_v0001.mp4",
	      "prompt": "...",
	      "provider": { "providerId": "aihubmix", "endpointKind": "openai", "baseUrl": "https://aihubmix.com/v1", "model": "sora-2" }
	    }
	  ]
	}
```

### 5.7 单机位修正（覆盖策略）
- 默认“重新生成”：重生成母图 → 切片 → 新 `GridID`。  
- 单机位修正：对某 slot 调用单图生成（默认 1K）→ 覆盖该 slot 切片 → 记录 `slotRevision`（可回滚）。  
- ZIP 交付：以最新 slotRevision 为准；manifest 可选记录 `overrides[]`（覆盖历史）。

### 5.8 Offline Mode（离线边界）
- 离线允许：查看项目、编辑剧本/Prompt、查看历史图片/视频、重新切片、ZIP 导出、导入导出项目。
- 离线禁止：图片生成、视频生成、Prompt 润色/翻译（任何云调用能力）。

### 5.9 Prompt 策略与 Schema（对齐 V4.0 的 Agent 设计）
> 目的：把“提示词策略”从口头约定变成可校验的输出结构，降低 LLM 幻觉导致的前端崩溃与逻辑偏差。

- **Agent 1：Narrative Atomizer（剧本拆解师）**
  - 输入：完整剧本文本（Script）
  - 输出（JSON）：`context`（200-300字）+ `scenes[]`（场景粗切分）+ `beats[]`（节拍细切分，挂在 scene 下）+ `shots[]`（挂在 beat 下的线性时序镜头列表）
  - 强约束：
    - `shots[].originalText` 必须是原文锚点（不得改写/不得删句）。
    - `beats` 必须能覆盖全部 Script（允许 overlap 标注但不得丢失文本）。
    - `sceneId/beatId/shotId` 三者必须可追溯（用于后续命名与交付）。
    - Beat 数量目标：默认 `15~30` beats/episode（更细优先）；若超过该范围必须给出原因并提示用户后续可手动合并/拆分。
- **Agent 2：Matrix Engineer（九机位提示词工程师）**
  - 输入：`globalStyle` + `linkedAssets` + `shot.visualTranslation`
  - 输出（JSON）：九机位 Prompt，格式包含“剧本主体语种画面描述 + 英文镜头/光影术语 + 机位标签（EST/OTS/CU...)”
  - 强约束：输出必须可被规范化为 `string[9]`（无论 provider 返回 object 还是 array），以减少组件耦合。
  - 语言硬约束：
    - 除镜头术语/参数外，**必须**使用 `scriptLanguage`（默认中文）输出，不得把叙事主体强制翻译为英文。
    - 必须以 `shot.originalText` 作为“事实底座”，不得添加与原文矛盾的设定；允许影视化视觉转译，但不得改写原文锚点。

#### 5.9.1 Prompt Budgeter + Lint（P0，降低失败率与成本）
> 风险：9 槽 Angle 文字 + 资产锁定 + Ref Map + Preset + JSON 包裹易超长，导致失败/截断/偏离/成本上升。

- 预算单位：以“字符数预算 + 结构规则”为主（避免 token 精算依赖分词器）
- Angle 文本必须 **Style-free**，并做去重（禁止 9 槽重复堆叠同样修饰词/风格词）
- 超限自动降噪：先删重复修饰/冗余术语，再压缩“主体语种画面描述”（必须产出 `budgetReport` 可追溯）
- Lint（阻断式）：JSON schema 不合法/slot 缺失/包含禁止指令（例如“分别生成 9 张图”“生成文字水印/额外拼贴”）→ `POLICY_VIOLATION`

### 5.10 物理切片像素规则（网格对齐硬标准）
> 目标：不同画幅/分辨率下都能严格按像素等分，避免 1px 缝隙、拉伸或错位。

- 默认 3x3 切割（不做 AI 识别）；以像素尺寸 `W x H` 为准。
- 建议分割策略（避免整除问题）：
  - `w0 = floor(W/3)`, `w1 = floor(W/3)`, `w2 = W - w0 - w1`
  - `h0 = floor(H/3)`, `h1 = floor(H/3)`, `h2 = H - h0 - h1`
  - 以 `(x,y,width,height)` 逐格裁剪，确保 9 块覆盖完整原图，无重叠无缺口。

#### 5.10.1 网格鲁棒性：margin/自检/校准（P0，主路径地基）
> 风险：AI 生成 3x3 网格存在轻微像素偏差/边框不一致，导致切片错位与边框残留，破坏“单母图→切片”的一致性与对账。

- 母图 Prompt 必须包含“严格 3x3 等分网格”约束（由 Main 统一拼接，Renderer 仅展示镜像提示）
- 切片默认启用“安全裁切 margin”（建议内缩 1%~2%，避免切到边框线/黑边）
- 推荐提供一次性“网格校准”（用户拖拽分割线/四角对齐）并保存到 Episode 配置，后续切片复用
- 切片自检（不依赖 AI）：基于亮度投影/边缘检测粗判 2 条竖分割+2 条横分割是否存在；失败则提示启用校准或重生成（记录 `GRID_LAYOUT_INVALID`）

### 5.11 ZIP 打包规范（交付一致性）
交付支持两种模式（可并存），需求方倾向**优先“按目录直接落盘”**：

1) **目录落盘（优先）**
   - 默认把母图/切片/manifest 写入 Workspace 的 `output/{ProjectName}/season_{SeasonNo}/episodes/{EpisodeID}/shots/{ShotID}/grid_{GridID}/`（见 4.2.1）。
   - 适用：本地工作流、团队共享盘、后续 DCC 管线直接读取文件夹。

2) **ZIP 打包（可选）**
   - ZIP 文件名建议（按行业层级可读）：
     - 优先：`{ProjectName}_S{SeasonNo}E{EpisodeNo}_{YYYY-MM-DD}.zip`
     - 回退：`{EpisodeID}_{YYYY-MM-DD}.zip`
   - ZIP 内容：
     - 多镜头：按 `Project/Season/Episode/Shot/Grid` 分层目录存放，避免同名冲突（与 4.2.1 对齐）。
     - 每个 GridRender 必须包含：母图 + 9 切片 + `manifest.json`。
     - 导出选项：拆分为“图片/视频”两类（可独立勾选）。
       - 图片（默认勾选）：母图 + 9 切片 + `manifest.json`
       - 视频（默认不勾选，体积大）：用户勾选“包含视频”后再写入 ZIP 的 `videos/`（manifest 仍需记录视频条目与路径）。

### 5.12 Legacy 数据与行为迁移（P0 阻断 + P1 最佳努力）
> 目的：避免旧原型的坏习惯（LocalStorage/Base64/前端直连）在桌面版延续，同时尽量保留历史。

- P0（必须）：启动检测到旧存储结构/大体积 Base64/疑似明文 key → 明确提示不再使用该方式，并提供“导出旧数据（JSON/ZIP）”留存
- P1（可选）：最佳努力迁移到“SQLite 元数据 + 本地媒体库”；失败则落盘 `imports/legacy_dump.zip` 并生成 `migration_report.json`
- 迁移必须分批处理并设置体积阈值，避免启动卡死

### 5.13 代理与网络可用性（P1）
- 支持读取系统代理；支持用户显式配置代理（不改变“前端零密钥”，请求仍由 Main 发起）
- 任务持久化包含 request fingerprint，避免网络抖动下重复提交同一生成任务

---

## 6. 功能模块开发方案（对齐 V4.0 A-F + 视频）
### A. 剧本预处理与镜头拆解（Phase 1）
- A1 全局概括：200-300 字 Context（后续作为 system/context 注入）。
- A2 智能分段（双轨）：先 Scene（粗）后 Beat（细），并确保覆盖全剧本原文（不可删减）。
- A3 时序镜头列表：Shot 挂在 Beat 下，携带 `sceneId/beatId`；原文锚点高亮 + 视觉转译（按剧本主体语种，默认中文）。

### B. 全局资产与风格配置（Phase 2 的前置）
- B1 Episode Style Preset（双套）：
  - `Image Style Preset`：仅用于 3x3 母图（图片模型）
  - `Video Style Preset（Sora2 / \`sora-2\`）`：仅用于视频生成（Sora-2）
  - 规则：Angle 9 槽 Prompt 保持 **Style-free**；生成时由主进程在母图 JSON 顶层一次性注入 `Image Style Preset`，覆盖所有 Angle；视频同理在顶层注入 `Video Style Preset`。
- B2 角色库（强制约束）：角色 ref 必填；镜头引用到角色时必须触发注入（触发词策略）。
- B3 场景/道具库：可选 ref；但“至少绑定 1 场景实体”是生成前置校验。

补充（需求方确认）：允许“纯环境镜头（Establishing/环境展示/空间交代）”不绑定角色，但**必须绑定场景**，且该镜头依然属于叙事单元不可忽略。建议在 Shot 上增加 `shotKind`（`CHAR`/`ENV`/`POV`/`INSERT`/`MIXED`），并在 UI 提供显式切换与提示，避免自动分类误伤。

补充（必要能力）：基于角色参考图生成“Identity Lock Prompt”，并在所有 Angle/视频生成中复用，以提升跨机位一致性；场景/道具同理（Environment/Prop Lock Prompt）。必要时支持“多参考图拼图 + Ref Map 描述”输入策略。

### C. 矩阵 Prompt 编辑器（Phase 2）
- C1 九宫格预览：`[机位标签] + 主体语种画面描述 + 英文术语`。
- C2 Human-in-the-loop：支持单格修改；支持“重新生成矩阵 Prompt”（基于用户意图重写 9 槽）。
- 关键：九机位文本对应同一 Shot 的 9 个 Angle，只用于拼接母图 JSON（顶层注入 Image Style Preset），不触发 9 次生成；Angle 文本本身不包含 Style Preset。

### D. 任务参数与并发控制（Phase 3）
- D1 规格设置：画幅/分辨率；画幅仅允许 `16:9` 与 `9:16`；高分辨率提示成本与耗时。
- D2 队列：多镜头批量加入队列；并发按能力分池：`LLM=10` / `IMG=5` / `VID=3`；支持在 Provider 侧临时限流/并发超限时“自动降级并发 + 冷却期恢复”；状态与错误可见。

### E. 结果浏览与交付（Phase 3）
- E1 时间线/瀑布流：按剧情顺序展示母图与切片。
- E2 Lightbox：大图缩放；左右切换；快捷键。
- E3 交付：单图/批量/ZIP（带 manifest）；支持重生成/重切片与历史回滚。

### F. 易用性改善
- F1 Auto-save：编辑与媒体指针实时保存；刷新不丢数据。
- F2 快捷键：`Ctrl+Enter` 生成；`Left/Right` 切换。
- F3 Prompt 润色：小按钮调用 LLM，将口语描述在**同一主体语种**下改写为更适配生图/生视频的表述（仍遵循队列；不得强制翻译为英文）。

### H. 国际化（i18n）
- UI 必须支持中英双语切换（默认中文），i18n 资源随离线构建一起打包。
- Prompt 语言策略：按剧本主体语种输出（默认中文）+ 英文镜头术语；视频与图像保持一致；不强制全英文。

### G. 视频派生与关联
- 任意母图/切片可触发视频任务；Prompt 可编辑；结果关联回 shot/grid/slot。

---

## 7. 里程碑与排期（建议）
- M1（桌面化基线，约 3-4 天）：Electron 壳 + IPC 合约 + SQLite 元数据；Provider 适配；TaskQueue 雏形（可恢复）；前端零密钥落地。
- M2（核心闭环，约 3-5 天）：Scene/Beat→Shot 解析链路；矩阵 Prompt；母图→切片→命名→manifest；任务中心可视化；ZIP 导出。
- M3（体验与生产力，约 3-5 天）：批量生成与失败恢复、单机位覆盖/回滚、视频派生与关联、离线资源本地化（移除 CDN 依赖）、GitHub Actions 三端发布。

---

## 8. 任务拆解（P0/P1/P2，可直接进迭代）
| 优先级 | 任务 | Owner | 交付物（最小可验收） | 预估 |
| --- | --- | --- | --- | --- |
| P0 | Electron 壳与打包基线 | Desktop | electron-builder 可打包三端产物；dev 热更新可用 | 2d |
| P0 | Renderer/Main 分离与 IPC 合约 | Desktop+FE | `main/preload.ts` 仅暴露最小 API；`invoke` 合约稳定；前端零密钥（无任何 key 注入） | 1-2d |
| P0 | SQLite 元数据层（season.db + episode.db） | Desktop | `season.db/episode.db` 可创建/迁移；基础 CRUD 可用 | 2-3d |
| P0 | Provider 适配（Main 执行）：aihubmix 作为唯一 Source | Desktop | base_url 固定 aihubmix；参数归一化 + 错误码映射 | 1-2d |
| P0 | TaskQueue（p-queue + tasks 表恢复） | Desktop | 队列强制调度；取消/重试/超时；重启恢复 PENDING | 2-3d |
| P0 | GenerationPolicy（Main 权威，Renderer 镜像提示） | Desktop+FE | 强制校验与结构化错误；UI 缺项提示 | 1d |
| P0 | 母图→切片→命名→manifest（本地文件产物） | Desktop | grid master + 9 slices + manifest.json 落盘 | 2-3d |
| P0 | Prompt Budgeter + Lint | Desktop | 超限告警+自动降噪+budgetReport；阻断非法 prompt | 1-2d |
| P0 | 网格鲁棒性：margin/自检/校准 | Desktop+FE | 自动切片稳定；自检失败可校准并复用；记录 `GRID_LAYOUT_INVALID` | 1-2d |
| P0 | Legacy 导出与阻断 | Desktop | 检测旧数据并可导出留存；避免旧存储继续污染 | 1d |
| P1 | 资产库本地化（ref 从 Base64→文件） | Desktop+FE | Season 资产可复用；Episode 引用/覆盖关系可追溯 | 2-3d |
| P1 | ZIP 导出（本地生成/打包） | Desktop | ZIP 含母图/切片/manifest；导出目录可配置 | 1-2d |
| P1 | 最佳努力迁移（Legacy→新结构） | Desktop | 迁移成功可用；失败有落盘与报告 | 1-2d |
| P1 | 代理/网络可用性 | Desktop+FE | 读取系统代理+可选手动配置；失败提示可执行 | 1d |
| P1 | 长列表性能（虚拟滚动/懒加载） | FE | Beat/Shot/任务/图库在大项目下不卡顿 | 1d |
| P1 | 路由与壳层（Home→Workspace） | FE | `HashRouter`；Season/Episode 列表入口；可打开/创建 Episode 并进入工作台 | 1-2d |
| P1 | 任务中心/批量生成/Lightbox | FE | 批量入队 + 状态可见；大图预览与快捷键 | 2-3d |
| P2 | 单机位覆盖与回滚（slotRevision） | Desktop+FE | 单 Angle 修正覆盖切片；历史回滚；manifest 追溯 | 1-2d |
| P2 | 视频派生与关联（图片→视频） | Desktop+FE | video 任务入队 + 关联 Episode/Shot/Grid/Slot | 2-3d |
| P2 | GitHub Actions 三端发布 | DevOps | Push tag 自动 build + release（dmg/exe/AppImage） | 1-2d |

---

## 9. 关键风险与缓解
- 误实现为 9 次生成：通过“主路径约束 + 代码注释 + UI 文案 + GenerationPolicy”硬性防跑偏。
- 4K 耗时与失败率：队列 + 超时 + 退避 + 降级建议（默认 2K，单机位 1K）。
- 本地磁盘膨胀：母图/视频体积大 → 仅手动清理（MVP 已拍板）+ 缩略图 + 导出后可选清理 + 超配额提示（不自动删，避免误删不可回滚）。
- Provider 差异：适配层统一字段与错误码，避免 UI/业务层分叉。

### 9.1 输出保留策略（已拍板：MVP 仅手动清理）
已拍板口径：MVP 阶段不做任何自动删除；仅提供“手动清理 + 导出后可选清理 + 超配额提示”。
为避免“磁盘爆炸”与“误删不可回滚”两类事故，实现时建议遵循以下口径（仍可在后续版本再拍板默认保留量）：
- **保留对象**：母图/切片/视频/manifest/任务日志/缩略图，各自是否同生命周期。
- **保留单位**：按 `Episode`（优先）或按全局；是否按 `Shot` 细分。
- **清理触发**：手动清理 + “导出后可选清理” + 超出配额提示。
- **可回滚性**：清理必须可预览（列出将删除的 gridId/文件大小），并生成 `cleanup_report.json` 供追溯。

---

## 10. Definition of Done（最终验收口径）
- 主路径正确：每镜头默认只触发 1 次母图生成；切片物理切割；单机位修正覆盖切片且可回滚。
- 强一致性落地：未满足 Prompt 9/9 与（≥1 角色 + ≥1 场景）时，生成按钮/队列入口必须阻断并给出缺项清单。
- 队列治理：所有生成类 API 必经全局队列；支持取消/重试/超时；错误码分类可见且一致。
- 交付可追溯：命名符合规范；ZIP 内含 manifest；可由 manifest 还原 shotId/gridId/slot/prompt/assetIds；若选择“包含视频”，ZIP 同时包含 `videos/` 且可追溯到 slot/revision。
- 存储稳定：生成结果统一落到 Workspace 的 `output/`（用户可见入口），元数据落 SQLite；可导出 ZIP（含 manifest）作为备份；具备生命周期清理策略（按 gridId/历史版本）。
- Provider 策略满足需求：**仅 aihubmix**；密钥只存在 Main/Local-Backend，不出现在 Renderer bundle/URL/日志明文；模型 ID 通过“锁定注释”集中管理且仅允许维护者人工修改；Schema 校验与错误分类具备实施路径。
- 目录结构达标：repo 内形成 `main/` + `renderer/` + `shared/` 三块；Renderer 严格 Browser-only；Shared 为纯 TS；Main 承担 Provider/FS/DB/导出。
- 边界可验证：存在门禁（CI/lint/脚本均可）确保 `renderer/` 不依赖 Provider SDK/适配层，且媒体访问不通过任意 `file://` 直读。

---

## 11. Phase 4 执行计划（Product Polish & Experience）
> 状态：**已确认并锁定**
> 核心目标：可见收益 → 体验闭环 → 一致性 → 系统化

### 11.1 执行顺序（已拍板）

1. **全局配置 UI 与透传**
   - **内容**：Ratio 仅支持 `16:9` (Default) / `9:16`；Resolution 默认 `2K`。
   - **要求**：UI 增加选择器；参数必须透传至 Main 进程。

2. **Video 生成 UX**
   - **内容**：增加生成确认弹窗；提供详细状态流转（Queued → Processing → Downloading → Completed）。
   - **要求**：用户必须明确感知视频生成的高成本与当前进度。

3. **资产一致性策略 V1**
   - **内容**：角色/道具/场景三类资产显式注入 Prompt。
   - **要求**：在 Prompt 组装时，必须包含 `Subject` (Character), `Wearing`, `Holding` (Prop), `Environment` (Scene) 的明确描述。

4. **UI/UX 主题与可读性**
   - **内容**：支持 Light/Dark 双主题；提升字体与图标的可读性。
   - **要求**：符合无障碍标准，高对比度，长时间使用不疲劳。

5. **i18n 国际化**
   - **内容**：架构支持多语言；默认 `zh-CN`；支持系统语言探测；`en-US` 作为回退。
   - **要求**：所有 UI 文本提取到资源文件；Prompt 生成逻辑支持语种配置（虽然默认中文）。

6. **Phase 4 Smoke Test**
   - **内容**：Text → Image → Video 全链路复测。
   - **验收**：覆盖所有新特性，确保无回归。

### 11.2 验收方式
- **明确验收点**：每一项都设定明确验收点（UI 入口可见、配置透传有效、生成流程可追踪、资产映射可读、语言可切换）。
- **通过标准**：Phase 4 结束以 Smoke Test 通过为准。

### 11.3 计划安排
- **Step 1 (Control)**：先做 **配置 UI + Video UX**，确保用户可控与流程清晰。
- **Step 2 (Consistency)**：再做 **资产一致性 V1**，解决多资产映射与 Prompt 结构。
- **Step 3 (Polish)**：最后补齐 **主题与 i18n**，完成产品层体验打磨。
