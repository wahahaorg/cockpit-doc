# CEO 现金流驾驶舱 V3 MVP 后端数据流图

文档版本：V0.2（已对照代码校对）
目标读者：前端、后端、产品、测试和后续接手项目的工程同学
阅读目标：读完后能看清数据从财务 Excel 进入系统后，如何流向标准表、计算模块、老板拍板事件、AI 解释和前端页面。

## 1. 总体数据流

这张图描述 MVP 后端的主链路。系统的核心不是 AI 直接生成经营结论，而是先把财务数据标准化，再由规则引擎生成确定性结果，AI 只在用户点击解释时读取已沉淀的事实。

~~~mermaid
flowchart LR
    A[财务 Excel<br/>账户余额/应收款/实际回款/计划支出] --> B[导入解析]
    B --> C[原始行留存<br/>raw_import_row]
    B --> D[字段标准化与校验]
    D --> E[导入批次<br/>import_batch]
    D --> F[标准业务表]
    F --> F1[账户余额]
    F --> F2[应收款]
    F --> F3[实际回款]
    F --> F4[计划支出]
    E --> G[发布批次]
    G --> G1[生成 Task 催收任务]
    G --> G2[首次刷新决策事件]
    G --> H[当前已发布数据版本]
    H --> I[现金流预测]
    H --> J[回款风险计算]
    H --> K[付款建议计算]
    J --> L[老板拍板事件<br/>decision_event]
    K --> L
    K --> K1[付款建议表<br/>payment_assessment]
    L --> M[AI 按需解释<br/>SSE 流式]
    K1 --> M2[AI 按需解释<br/>同步接口]
    I --> N[大屏首页]
    J --> N
    K --> N
    L --> N
    M --> N
~~~

## 2. 导入与标准数据落表流

导入模块会同时保存"原始行"和"标准业务表"。原始行用于追溯和审核，标准业务表用于后续规则计算。

~~~mermaid
flowchart TB
    A[上传 Excel] --> B[文件类型检查<br/>仅 .xlsx]
    B --> C[模板版本检查<br/>当前 V0.1]
    C --> D[文件哈希去重<br/>SHA-256]
    D --> E[解析工作簿]
    E --> F[逐行标准化]
    F --> G[字段校验]
    G --> H[写入导入批次<br/>status=pending_review]
    G --> I[写入原始行<br/>原始值/标准化值/错误消息]
    G --> J{行是否阻断错误}
    J -->|否| K[写入标准业务表]
    J -->|是| L[保留错误行<br/>批次 status=validation_failed]
    K --> K1[账户余额]
    K --> K2[客户<br/>Customer 跨批次共享]
    K --> K3[应收款]
    K --> K4[实际回款]
    K --> K5[计划支出]
    H --> M{发布批次<br/>POST /{id}:publish}
    M -->|无阻断错误| N[切换当前已发布批次<br/>旧批次回退 pending_review]
    N --> O[生成 Task 催收任务<br/>逾期应收→task]
    N --> P[首次刷新决策事件<br/>refresh_decision_events]
    M -->|有阻断错误| Q[拒绝发布<br/>422 batch_has_blocking_errors]
~~~

> **注意**：`Customer` 表不绑定批次，同一客户编号全局复用（`customer_code` 唯一）。
> 导入过程中 warning 行也会写入标准业务表，只有 error 行被排除。

## 3. 30 / 60 / 90 天现金流预测数据流

现金流预测只使用当前已发布批次。它先生成一条 90 天逐日曲线，再从同一条曲线切出 30、60、90 天窗口，避免不同模块公式不一致。

~~~mermaid
flowchart LR
    A[当前已发布批次] --> B[读取账户余额]
    A --> C[读取应收款]
    A --> D[读取实际回款]
    A --> E[读取计划支出]
    B --> F[取每个账户基准日前最新余额<br/>多账户求和]
    C --> G[计算应收未回金额<br/>ReceivableFact]
    D --> G
    G --> H{预计/到期日是否早于基准日}
    H -->|是| I[计入逾期未确认金额<br/>overdueUnconfirmedAmount<br/>不进入未来曲线]
    H -->|否| J[作为未来预计流入<br/>使用 expected_date 优先于 agreed_due_date]
    E --> K[筛选 planned/pending/approved<br/>作为未来计划流出]
    F --> L[期初余额 openingBalance]
    J --> M[90 天逐日现金流曲线<br/>build_daily_forecast]
    K --> M
    L --> M
    M --> N[30 天窗口摘要]
    M --> O[60 天窗口摘要]
    M --> P[90 天窗口摘要]
    M --> Q[每日 expectedInflow/plannedOutflow/netFlow/predictedBalance]
~~~

现金流每日核心公式：

当日预测余额 = 昨日预测余额 + 当日预计流入 - 当日计划流出。

窗口摘要使用同一条曲线计算最低余额、最大缺口、缺口日期、首次跌破安全线日期和恢复日期。

> **当前边界**：预计回款日期优先使用 `expected_date`，未填则回退 `agreed_due_date`。所有 `planned/pending/approved` 状态的支出都进入流出预测（不区分是否已实际付款）。

## 4. 回款风险 Top 3 数据流

回款风险模块追溯到应收款和实际回款。实际回款用于抵扣应收金额，剩余未回部分才参与风险判断。

~~~mermaid
flowchart TB
    A[应收款] --> C[按应收编号聚合<br/>ReceivableFact]
    B[实际回款] --> C
    C --> D[计算未回金额<br/>outstanding = receivable_amount - collected]
    D --> E{未回金额是否大于 0}
    E -->|否| F[不进入风险候选]
    E -->|是| G[计算逾期天数和距到期天数]
    G --> H{风险等级}
    H -->|逾期 >=30 天<br/>或逾期且未回 >=100 万| I[红色风险]
    H -->|已逾期但未红<br/>或 0-2 天临期| J[黄色风险]
    H -->|其他| K[绿色]
    I --> L[读取最新跟进记录<br/>FollowupRecord]
    J --> L
    L --> M[风险排序<br/>红>黄>绿 / 逾期天数 / 金额]
    M --> N[Top 3 返回给前端]
    M --> N2[全量返回<br/>GET /receivable-risks]
    I --> O[老板拍板事件候选<br/>refresh_decision_events]
~~~

> **与文档 V0.1 的差异**：每条风险项会附带最新一条跟进记录（`lastFollowupDate`/`lastFollowupNote`）。

## 5. 付款建议 Top 3 数据流

付款建议模块会复用现金流预测输入。它先按支出状态做资格判断，再按付款队列逐笔把支出放进现金流曲线中试算，结果持久化到 `payment_assessment` 表。

~~~mermaid
flowchart TB
    A[计划支出] --> B{审批状态}
    B -->|planned/pending| C[not_ready<br/>未完成审批]
    B -->|cancelled| D[排除<br/>不进入计算]
    B -->|approved| E[进入付款队列]
    E --> F[排序<br/>刚性优先/逾期优先/计划日优先]
    F --> G[读取现金流基础曲线<br/>已 approved 支出排除后的基准曲线]
    G --> H[逐笔模拟付款<br/>_replace_amount]
    H --> I{最大现金缺口是否增加}
    I -->|否| J[pay<br/>建议可付<br/>此笔纳入后续曲线]
    I -->|是 + 刚性支出| K[boss_review<br/>需老板拍板<br/>此笔仍纳入曲线]
    I -->|是 + 可延期支出| L[defer<br/>建议暂缓<br/>此笔不纳入曲线]
    J --> M[写入 payment_assessment 表<br/>含证据快照/缺口前后对比]
    K --> M
    L --> M
    C --> M
    M --> N[付款建议 Top 3<br/>boss_review > defer > not_ready > pay]
    K --> O[老板拍板事件候选<br/>refresh_decision_events]
~~~

> **与文档 V0.1 的差异**：
> 1. 评估结果持久化到 `payment_assessment` 表，包含 `gap_before/gap_after/gap_increase/evidence_snapshot`。
> 2. Top 3 排序优先级：`boss_review(0) > defer(1) > needs_evidence(2) > not_ready(3) > pay(4)`，相同决策内再按缺口增量降序。
> 3. 实际代码还有 `needs_evidence` 状态（当前逻辑尚未触发，预留扩展用）。

需要注意：付款建议不是每笔独立计算。前一笔支出是否纳入曲线，会影响后一笔支出的缺口试算结果。

## 6. 今日老板要拍板数据流

老板拍板模块只接收已经达到升级条件的事件。当前 MVP 有两个来源：红色回款风险、付款建议中的 boss_review。

~~~mermaid
flowchart LR
    A[回款风险计算] --> B{是否红色风险}
    B -->|是| C[回款风险拍板事件<br/>event_type=receivable_risk]
    B -->|否| D[不进入拍板]
    E[付款建议计算] --> F{是否 boss_review}
    F -->|是| G[付款拍板事件<br/>event_type=payment_assessment]
    F -->|否| H[不进入拍板]
    C --> I[按 business_key 幂等刷新<br/>pending 事件更新证据/金额<br/>已 decided 事件在新周期重新打开]
    G --> I
    I --> J[decision_event]
    J --> K{事件状态}
    K -->|pending| L[首页今日老板要拍板]
    K -->|decided| M[已决策留痕<br/>同批次内不重新打开]
    K -->|closed| N[风险源消失自动关闭<br/>closed_reason=source_risk_resolved]
    L --> O[老板提交处理选项<br/>POST /{id}:decide]
    O --> M
~~~

> **触发时机**：
> 1. **发布批次时**：`publish_batch()` → `_generate_tasks()` → `refresh_decision_events()` 同步触发一次全量刷新。
> 2. **每次查询拍板列表时**：`GET /decision-events` 也会实时调用 `refresh_decision_events()` 刷新。
>
> **幂等逻辑细节**：若 `pending` 事件已存在则更新证据快照/金额；若最近一次为 `decided` 且 `closed_reason=None`，则更新证据但不立即重新打开新周期。

现金缺口目前不单独生成老板拍板事件。它是付款建议和回款风险的证据来源之一。

## 7. AI 解释数据流

AI 解释分两条路径：①决策事件的 SSE 流式解释；②付款建议的同步解释（结果写回 DB 可缓存）。二者均不参与规则计算，也不改变事件状态。

~~~mermaid
sequenceDiagram
    participant U as 前端用户
    participant API as 后端 AI 接口
    participant DB as DB（事件/评估表）
    participant LLM as Qwen Plus

    Note over U,LLM: 路径 A：决策事件 SSE 解释
    U->>API: GET /decision-events/{id}/ai-explanation:stream
    API->>DB: 读取 decision_event（证据快照/可选项）
    alt AI 未启用或未配置 Key
        API-->>U: SSE 返回确定性降级解释文本
    else AI 可用
        API->>LLM: 发送结构化事实和约束 Prompt
        LLM-->>API: 流式返回解释文本
        API-->>U: SSE delta/done（degraded=false）
    end

    Note over U,LLM: 路径 B：付款建议同步解释（可缓存）
    U->>API: POST /payment-recommendations/{id}/ai-explanation
    API->>DB: 读取 payment_assessment
    alt 已有缓存 ai_explanation
        API-->>U: 直接返回缓存（cached=true）
    else 首次请求
        API->>LLM: 发送结构化付款评估 Prompt
        LLM-->>API: 同步返回解释文本
        API->>DB: 写回 ai_explanation 字段
        API-->>U: 返回解释文本（cached=false）
    end
~~~

> AI 只解释传入事实：不重新计算金额，不补充不存在的数据，不替老板做最终决策。
> 路径 B 的解释写回 `payment_assessment.ai_explanation`；若评估结果发生变化（`changed=True`），该字段会被清空，下次请求重新生成。

## 8. 前端页面到后端数据源映射

| 前端模块 | 主要接口 | 后端数据来源 | 备注 |
| --- | --- | --- | --- |
| 大屏总览（四张卡片） | GET /api/v1/cockpit/overview | 账户余额、应收款、实际回款、计划支出 | 含现金缺口/逾期总额/任务数 |
| 30 / 60 / 90 天现金流 | GET /api/v1/cashflow-forecasts | 账户余额、应收款、实际回款、计划支出 | 返回窗口摘要和 90 天逐日曲线 |
| 回款风险 Top 3 | GET /api/v1/receivable-risks/top3 | 应收款、实际回款、客户 | 只返回 red/yellow |
| 回款风险全量 | GET /api/v1/receivable-risks | 应收款、实际回款、客户、跟进记录 | 可按 riskLevel/ownerCode 过滤 |
| 付款建议 Top 3 | GET /api/v1/payment-recommendations/top3 | 计划支出、现金流曲线 | 每次请求均刷新 payment_assessment 表 |
| 付款建议 AI 解释 | POST /api/v1/payment-recommendations/{id}/ai-explanation | payment_assessment | 同步；结果写回 DB，支持缓存 |
| 今日老板要拍板 | GET /api/v1/decision-events | 回款风险、付款建议 | 每次请求均刷新 decision_event |
| 拍板事件详情 | GET /api/v1/decision-events/{id} | decision_event | 返回完整证据快照和可选项 |
| 拍板事件提交 | POST /api/v1/decision-events/{id}:decide | decision_event | 部分选项需 payload 补充字段 |
| AI 解释依据（流式） | GET /api/v1/decision-events/{id}/ai-explanation:stream | 决策事件证据快照 | SSE 按需输出；无缓存 |
| 催收任务列表 | GET /api/v1/tasks | Task 表 | 批次发布时生成；可按 date/status 过滤 |
| 催收任务状态更新 | PATCH /api/v1/tasks/{id} | Task 表 | 乐观锁（version 字段） |
| 应收款跟进记录 | POST /api/v1/receivables/{id}/followups | FollowupRecord | 跟进记录会出现在风险列表的 lastFollowupNote |
| 支出试算 | POST /api/v1/expense-simulations | 当前批次总览数据 | 不影响正式数据；仅做影响估算 |
| 数据审核后台 | /api/v1/imports 相关接口 | 导入批次、原始行、标准表 | 用于财务数据检查和发布 |
| 标准数据查看 | /api/v1/account-balances, /receivables, /collections, /planned-expenses, /customers | 各标准表 | 可按 batchId 查指定批次 |

## 9. 当前数据流边界

1. 当前没有真实付款事实表，计划支出是否已经实际支付依赖 `approval_status` 字段维护；`planned/pending/approved` 的支出均进入流出预测，存在高估风险。
2. 当前没有独立的数据清洗配置系统，复杂财务表格建议先扩展导入清洗模块，而不是在大屏接口里硬处理。
3. 路径 A（决策事件）的 AI 解释**不写回** DB，每次请求均实时生成；路径 B（付款建议）的 AI 解释会**写回** `payment_assessment.ai_explanation`，支持缓存。如后续需要统一审计，建议两条路径都落表。
4. 当前老板拍板事件来源只包括回款风险和付款建议，现金缺口暂不单独升级。
5. 当前所有驾驶舱结果默认基于最新已发布批次，不读取未发布批次。
6. `Customer` 表跨批次共享（按 `customer_code` 全局唯一），不随批次重置；其余标准业务表均绑定 `import_batch_id`。
7. `refresh_decision_events` 在发布批次和查询拍板列表时都会触发，高频场景下应注意计算开销。
