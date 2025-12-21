# Hard Guardrails（硬约束执行说明）

本仓库对“模型 ID / Provider 配置 / 密钥安全”设置硬约束，目的是避免 AI/Agent 或非维护者基于旧知识擅自修改关键参数，导致线上成本、安全或质量事故。

相关规范与协作标准：
- `rules.md`：项目红线（Zero-Secret、aihubmix-only、Sora-2-only=`sora-2`、模型 ID 锁定等）
- `dev/reference_vibe-coding-skill/Vibe-Coding-Standard.md`：PM/Agent 协作标准（输入/交付/质量门禁）

---

## 1. 锁定范围（Locked Files）
以下文件/目录被视为“锁定区域”，任何改动都必须由维护者审核：

### 1.1 vNext 真实目录结构（下一阶段落地后的“权威位置”）
> 目标：让后续团队一眼就知道“模型 ID / Provider 配置”只能出现在哪里，避免散落在多个文件里导致分叉与误改。

建议目录（与 `dev/Plan-Codex.md` 对齐）：
- `main/`：Electron Main / Local-Backend（唯一允许触达 Provider Key 与外部 API 的位置）
- `renderer/`：UI（禁止触达任何 Provider Key）

在该结构下，以下路径属于“强锁定”：
- `main/modelIds.ts`（唯一权威：LLM/图片/视频（视频固定 `sora-2`）模型 ID；必须注释锁定）
- `main/providerConfig.ts`（唯一权威：aihubmix base_url、并发/超时/重试等 Provider 级参数；必须注释锁定）
- `main/providers/**`（Provider 适配层：aihubmix 文本/图片/视频；禁止出现 Gemini 官方直连实现）
- `main/providerRouter.ts` / `main/providerRegistry.ts`（vFuture 预留：Provider 路由/注册表；默认必须保持 aihubmix-only）

### 1.2 兼容现有与未来的 Glob（用于 CI / CODEOWNERS）
> 即使目录还没重构完成，也要先把“锁定边界”卡住。

- `**/modelIds.*`（LLM/绘图/视频模型 ID）
- `**/providerConfig.*` / `**/aihubmix.*` / `**/aiProvider.*`（Provider 配置与适配入口）
- `**/providers/**`（Provider 适配层目录下的所有文件）

### 1.3 迁移期的“临时高危文件”（建议同样视为锁定）
> 在完成“Renderer/Main 分离 + 前端零密钥 + aihubmix-only + Sora-2-only=`sora-2`”迁移前，下列文件修改极易引入密钥泄漏/模型漂移/离线不可用；建议维护者本人修改或要求强制 Review：

- `main/preload.ts`（安全边界：暴露面过宽会导致主进程能力泄漏到前端）
- `main/**/ipc*.*` / `main/ipc/**`（IPC 合约与参数校验：一旦出现“万能通道”容易被滥用）
- `vite.config.ts`（可能把密钥注入前端 bundle）
- `index.html`（可能引入 CDN/importmap 在线依赖）
- `constants.ts`（当前暂存 TEXT/IMAGE 模型 ID 与系统指令，迁移后应收敛到 `main/modelIds.ts` / `main/providerConfig.ts`）
- `services/geminiService.ts`（当前包含直接调用与视频模型 ID，迁移后应从 renderer 侧移除）

---

## 2. CI 硬门禁（必须通过）
启用 GitHub Actions 工作流：`.github/workflows/locked-files-guard.yml`

规则：
- PR 若修改了锁定区域，必须打上标签 `maintainer-approved`，否则 CI 直接失败。
- 可选：在工作流 env `LOCKED_FILES_ALLOWED_ACTORS` 增加维护者 GitHub 用户名 allowlist（仓库维护者自行配置）。

注意：
- “锁定目录”必须按“目录内所有文件”匹配（例如 `main/providers/**`），不能只匹配目录名本身，否则门禁会失效。
- 若未来引入 `main/providerRouter.ts` / `main/providerRegistry.ts` 等文件，请同步更新 `.github/workflows/locked-files-guard.yml` 的锁定匹配规则与 `.github/CODEOWNERS`，确保门禁真实生效。

---

## 3. CODEOWNERS（自动请求维护者 Review）
文件：`.github/CODEOWNERS`

说明：
- `.github/CODEOWNERS` 必须指向真实维护者 GitHub 用户名或团队（例如 `@your-org/maintainers`），当前维护者为 `@XucroYuri`。
- 建议在 GitHub 仓库设置中开启分支保护：Require review from Code Owners。
 - 若未替换占位符或未启用分支保护/CODEOWNERS Review，本文件描述的“硬门禁”将只停留在文档层，无法形成真实约束（开工前必须完成）。

注意（GitHub 计费/仓库可见性限制）：
- 在 **个人账号的私有仓库** 中，GitHub 可能会要求升级（例如 Pro/Team）或将仓库设为 Public，才允许启用 “Require review from Code Owners”。
- 若短期内无法启用 Code Owners 强制审核：请至少启用 Classic 分支保护的 “Require PR + Require status checks（Locked Files Guard）+ 禁止 force push/删除”，并通过 `Required approvals` + 人工流程保证关键改动有人审。

---

## 4. 分支保护（Repository Settings）
为了让约束真正“硬”，建议在 GitHub 开启：
- Branch protection（例如 `main`）
  - Require pull request reviews before merging（至少 1-2 个）
  - Require review from Code Owners
  - Require status checks to pass（勾选 `Locked Files Guard`）
  - Do not allow bypassing the above settings（按团队实际权限决定）

注意（GitHub UI 差异）：
- 若你在 **Rulesets**（新规则系统）里找不到 “Require review from Code Owners”，或页面提示 ruleset 不会在当前仓库形态生效（例如个人账号私有仓库），请改用 **Classic branch protection rule**（旧分支保护）来开启该选项并确保真实生效。

---

## 5. 密钥与开源卫生
- 禁止提交任何真实密钥；只提供 `.env.example`。
- 禁止把 key 拼到 URL、写入 LocalStorage/IndexedDB、或输出到日志明文。
- 桌面端密钥只存 Main/Local-Backend（OS Keychain 优先），Renderer 永远不接触。
- 交付产物不得内置 key；首次运行/缺失/不可用必须弹窗引导配置；并要求“设备绑定自动失效销毁”（以 Keychain/凭据库为根，或等价方案），细则见 `rules.md` 与 `dev/Plan-Codex.md`。
- 发布签名/激活私钥等发布级 Secrets 严禁入库：代码签名证书、notarization 凭据、Windows 签名私钥、激活服务签名密钥等只能存在于 CI Secrets 或维护者本地安全环境；日志必须脱敏。
