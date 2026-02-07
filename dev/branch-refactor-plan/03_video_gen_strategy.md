---
status: ARCHIVED
---

# 项目协同与功能借鉴建议 (Project Synergy Proposal)

> 历史文档说明：本报告为分支阶段策略快照，当前实施入口为 `rules.md` 与 `docs/*`。

**状态**: Draft
**基准**: `omni-director-pre-viz` (Desktop) vs `CineFlow` (Backend)
**目标**: 评估 `CineFlow` 视频生成能力的可用性，明确“借用”策略，避免重复造轮子。

---

## 1. 核心结论 (Executive Decision)

**立即停止** `omni-director-pre-viz` 中关于视频生成的全链路开发（包括 UI 上的 Veo 入口、旧的生成逻辑），转为**全面复用** `CineFlow` 的后端能力。

**理由**:
1.  **成熟度压倒性优势**: `CineFlow` 已具备完整的重试机制 (Tenacity)、并发控制 (Semaphore/Lock)、状态轮询 (Polling) 和错误处理，且已适配 `Sora-2` (通过 `settings.SORA_BASE_URL` 指向 aihubmix)。
2.  **Prompt 工程更深入**: `CineFlow` 的 `worker.py` 中实现了 `construct_enhanced_prompt`，包含资产注入 (Asset Integration) 和 Regex 格式清洗 (`@characterid`)，这正是 `omni-director` 目前缺失的“资产一致性闭环”。
3.  **零成本集成**: `CineFlow` 本质上是一个 Python Worker。虽然架构不同（Node/Electron vs Python），但业务逻辑（Prompt 组装、API 交互、下载）可以被翻译或以子进程/微服务形式调用。

---

## 2. 深度代码审查发现 (Code Review Findings)

### 2.1 值得“偷”的亮点 (High Value Assets)

#### A. 资产注入逻辑 (`worker.py: construct_enhanced_prompt`)
*   **代码片段**:
    ```python
    if segment.asset.characters:
        chars_str = ", ".join(str(c) for c in segment.asset.characters)
        asset_info.append(f"Characters: {chars_str}")
    # ...
    final_prompt = re.sub(r'(@\w+)(?!\s)', r'\1 ', final_prompt) # 关键修复
    ```
*   **价值**: 解决了 LLM 生成的 Prompt 中 Character ID 粘连导致模型无法识别的问题。这是 `omni-director` 目前未处理的边缘情况。

#### B. 健壮的 API Client (`api_client.py: SoraClient`)
*   **代码片段**:
    ```python
    retries = Retry(total=3, backoff_factor=1, status_forcelist=[502, 503, 504])
    adapter = HTTPAdapter(max_retries=retries, pool_connections=settings.MAX_CONCURRENT_TASKS)
    # ...
    @retry(retry=retry_if_exception_type((APIError, RateLimitError))...)
    ```
*   **价值**: 实现了 HTTP 协议层（502/503/504）与业务逻辑层（429/APIError）的双重重试。`omni-director` 目前仅有简单的内存限流。

#### C. 轮询状态机 (`worker.py: _process_task_internal`)
*   **价值**: 完整的 `submitted -> polling -> completed/failed` 状态流转，且包含 `MAX_POLL_TIME` (35分钟) 超时保护。这对于长耗时的 Sora-2 任务至关重要。

### 2.2 潜在的集成障碍 (Integration Risks)

1.  **语言栈不通**: `omni-director` 是 TS/Electron，`CineFlow` 是 Python。
    *   *缓解*: 不建议直接引入 Python 环境（部署复杂）。建议**将 `CineFlow` 的核心逻辑（Prompt 组装、API 交互模式）用 TypeScript 在 `omni-director` 的 `Main/Worker` 中重写**。逻辑复用 > 代码复用。
2.  **配置依赖**: `CineFlow` 依赖 `.env` 和 `settings.py`，且结构较为扁平。
    *   *缓解*: `omni-director` 已有 `GlobalConfig`，需将 `CineFlow` 的参数（如 `POLL_INTERVAL`, `MAX_POLL_TIME`）迁移至 TS 常量配置中。

---

## 3. 下一步行动建议 (Action Plan)

### 3.1 立即行动 (Immediate)
1.  **废弃** `omni-director` 中所有视频相关的 Prompt 拼接逻辑。
2.  **移植** `CineFlow` 的 `construct_enhanced_prompt` 逻辑到 `src/main/providers/aihubmix/sora2.ts` (需新建或重构)。
    *   重点移植：Asset 格式化字符串、Regex 清洗规则。
3.  **移植** 重试策略：在 `src/main/providers/limiters.ts` 或 `TaskRunner` 中，参照 `CineFlow` 的策略实现指数退避重试。

### 3.2 长期规划 (Long-term)
1.  **完全打通**: 若未来 `omni-director` 需要更复杂的脚本分析能力（如 `flow_demo.py` 中的 `ScriptIntelligenceEngine`），可考虑将 `CineFlow` 封装为独立的本地 Sidecar 服务（通过 stdio 或本地 HTTP 通信），但这增加了部署复杂度，MVP 阶段不推荐。
2.  **目前策略**: **"Logic Porting" (逻辑移植)**。将 Python 代码作为“伪代码/规格说明书”，在 TS 中实现等效逻辑。

---

## 4. 结论

`CineFlow` 是一个极佳的“参考实现” (Reference Implementation)。我们不需要它的代码（Python），但我们需要它的**灵魂**（资产注入规则、重试策略、轮询状态机）。

**决策**: 视频生成模块进入 **"Copy-Logic-Only"** 模式，全面复刻 `CineFlow` 的业务逻辑，不再自行探索 Prompt 策略。
