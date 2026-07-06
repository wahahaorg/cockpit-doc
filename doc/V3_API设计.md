# CEO 现金流驾驶舱 V3 API 设计

文档版本：V0.1  
基础路径：`/api/v1`  
调用方：同项目管理后台、老板端驾驶舱、后续 AI Tool 适配层

## 1. 设计约定

- V3 使用 REST，接口采用 URL 路径版本化。
- V3 内测可使用单管理员会话；正式认证和 RBAC 在阶段 4 补充。
- 列表接口使用 `page`、`pageSize`，`pageSize` 默认 20、最大 100，满足后台跳页需求。
- 上传、发布、重算等可重试操作支持 `Idempotency-Key`。
- 写接口使用 `version` 或 `If-Match` 防止静默覆盖。
- 日期为 `YYYY-MM-DD`，时间为 ISO 8601，金额返回十进制字符串，例如 `"1200000.00"`。
- 返回计算结果时必须携带批次、规则版本、复核状态和计算日期。

## 2. 通用响应

单对象：

```json
{
  "data": {},
  "meta": { "requestId": "req_xxx" }
}
```

分页列表：

```json
{
  "data": [],
  "pagination": { "page": 1, "pageSize": 20, "total": 86, "totalPages": 5 },
  "meta": { "requestId": "req_xxx" }
}
```

统一错误：

```json
{
  "error": {
    "code": "batch_validation_failed",
    "message": "批次存在阻断错误，不能发布",
    "details": { "batchId": "...", "errorRows": 3 },
    "requestId": "req_xxx"
  }
}
```

主要状态码：`400` 请求格式错误、`404` 不存在、`409` 状态/版本冲突、`413` 文件过大、`415` 文件类型不支持、`422` 业务校验失败、`500` 非预期错误。

## 3. 导入批次 API

### `POST /imports`

上传标准 Excel 并创建批次。`multipart/form-data`：`file`、`templateVersion`、`dataPeriodStart`、`dataPeriodEnd`。成功返回 `201` 和 `Location`。

```json
{
  "data": {
    "id": "uuid",
    "batchNo": "IMP-20260702-001",
    "status": "uploaded",
    "fileName": "财务样本.xlsx",
    "templateVersion": "V0.1",
    "createdAt": "2026-07-02T10:00:00+08:00"
  }
}
```

错误：`409 duplicate_file`、`413 file_too_large`、`415 unsupported_file_type`、`422 template_not_supported`。

### `GET /imports`

参数：`page`、`pageSize`、`status`、`createdFrom`、`createdTo`。返回批次摘要列表。

### `GET /imports/{batchId}`

返回批次状态、统计、数据期间、发布信息和各 Sheet 校验摘要。

### `POST /imports/{batchId}:validate`

触发重新解析和校验。要求 `Idempotency-Key`。仅 uploaded、validation_failed、pending_review 可执行。返回 `202`。

### `GET /imports/{batchId}/rows`

参数：`sheetName`、`validationStatus`、`page`、`pageSize`。返回原始值、标准化值及字段错误。

### `GET /imports/{batchId}/validation-errors`

分页获取错误。字段：`sheetName`、`rowNo`、`field`、`code`、`message`、`severity`。

### `POST /imports/{batchId}:publish`

整批发布并切换驾驶舱当前数据版本。要求 `Idempotency-Key` 和请求体：

```json
{ "version": 3, "reviewNote": "CFO 已完成样本核对" }
```

返回 `200`；错误：`409 invalid_batch_status`、`409 version_conflict`、`422 batch_has_blocking_errors`。

### `POST /imports/{batchId}:void`

作废未发布或错误批次；已发布批次需要先发布替代批次。请求体：`reason`、`version`。

## 4. 标准数据预览 API

以下接口均支持 `batchId`；不传时读取当前已发布批次。

- `GET /account-balances?asOfDate=&batchId=&page=&pageSize=`
- `GET /customers?keyword=&page=&pageSize=`
- `GET /receivables?customerId=&ownerCode=&riskLevel=&overdueOnly=&page=&pageSize=`
- `GET /receivables/{receivableId}`
- `GET /collections?receivableId=&dateFrom=&dateTo=&page=&pageSize=`
- `GET /planned-expenses?dateFrom=&dateTo=&approvalStatus=&page=&pageSize=`

`GET /receivables/{id}` 返回原始应收、累计回款、未回金额、逾期天数、风险等级、最近跟进和计算依据；不返回数据库内部无关字段。

V3 不提供通用 CRUD。发现原始数据错误时优先修正 Excel 并重新导入，避免后台修改后与财务源文件失去一致性。

## 5. 驾驶舱与指标 API

### `GET /cashflow-forecasts?asOfDate=2026-07-02`

返回未来 90 天统一滚动预测曲线，以及 30、60、90 天窗口内的最低余额、最大缺口和缺口日期。金额均为十进制字符串。该接口是付款建议试算复用的唯一现金流公式来源。

### `GET /receivable-risks/top3?asOfDate=2026-07-02`

返回红、黄风险候选统计和排序后的前三笔应收；候选不足三笔时按实际数量返回。

### `GET /payment-recommendations/top3?asOfDate=2026-07-02`

运行或刷新确定性付款评估，返回老板拍板、暂缓、补充依据、未就绪、可付顺序下最需要关注的三笔建议。评估结果写入 `payment_assessment`，相同批次、日期和规则版本幂等更新。

### `GET /cockpit/overview?asOfDate=2026-07-02`

```json
{
  "data": {
    "asOfDate": "2026-07-02",
    "periodStart": "2026-07-01",
    "periodEnd": "2026-07-31",
    "batchId": "uuid",
    "ruleVersion": "cashflow-rules-v0.1",
    "reviewStatus": "pending_cfo_review",
    "metrics": {
      "availableCash": "3000000.00",
      "expectedCollections": "1500000.00",
      "actualCollections": "700000.00",
      "plannedExpenses": "10500000.00",
      "cashGap": "6000000.00",
      "overdueAmount": "2680000.00",
      "todayTaskCount": 4
    },
    "cards": [
      { "code": "cash_sufficiency", "level": "red", "title": "钱够不够", "summary": "本月存在现金流缺口", "bossInterventionRequired": true }
    ],
    "warnings": ["当前规则待 CFO 确认，不作为正式经营结论"]
  }
}
```

### `GET /metrics/{metricCode}/evidence?asOfDate=&page=&pageSize=`

返回参与计算的来源记录、纳入/排除原因和公式编码，用于 CFO 下钻核对。

### `POST /calculations:recalculate`

按指定批次和日期重算指标、风险及任务。要求 `Idempotency-Key`。请求：`batchId`、`asOfDate`、`ruleVersion`。返回 `202`。

## 6. 回款风险与跟进 API

### `GET /receivable-risks`

参数：`asOfDate`、`riskLevel`、`ownerCode`、`overdueDaysMin`、`page`、`pageSize`。按风险等级、逾期天数、未回金额排序。

### `POST /receivables/{receivableId}/followups`

记录跟进。请求：

```json
{
  "content": "客户承诺本周五付款",
  "nextFollowupDate": "2026-07-04",
  "promisedCollectionDate": "2026-07-05"
}
```

返回 `201`。跟进记录只补充处理事实，不直接修改原应收金额和到账事实。

## 7. 今日任务 API

- `GET /tasks?date=2026-07-02&status=&riskLevel=&ownerCode=&page=&pageSize=`
- `GET /tasks/{taskId}`
- `PATCH /tasks/{taskId}`：请求 `status`、`ownerCode`、`ownerName`、`version`；返回更新后的任务。

非法状态迁移返回 `409 invalid_task_transition`。完成任务不等于回款到账，实际到账仍必须来自回款数据。

## 8. 支出试算 API

### `POST /expense-simulations`

不落正式付款，只计算“这笔钱能不能花”。

```json
{
  "asOfDate": "2026-07-02",
  "amount": "500000.00",
  "plannedDate": "2026-07-10",
  "category": "运营支出",
  "rigidity": "deferrable"
}
```

返回付款前后预测现金、现金缺口、风险等级、公式版本和警告。

## 9. AI Tool 适配接口

AI 不直接访问数据库。V3 可将下列稳定读接口包装为 Tool：

- `get_cashflow_overview(as_of_date)` → `/cockpit/overview`
- `list_receivable_risks(filters)` → `/receivable-risks`
- `get_metric_evidence(metric_code, as_of_date)` → `/metrics/{metricCode}/evidence`
- `simulate_expense(input)` → `/expense-simulations`

AI 只能解释 Tool 返回结果，不能自行补造数字或改变规则。

## 9.1 老板拍板 API

- `GET /decision-events?asOfDate=&status=pending&page=&pageSize=`：刷新规则结果并分页返回拍板事件；
- `GET /decision-events/{eventId}`：返回事件及结构化依据；
- `POST /decision-events/{eventId}:decide`：提交老板决定。

提交请求：

```json
{
  "option": "continue_followup",
  "note": "继续跟进至周五",
  "payload": { "newDeadline": "2026-07-10" },
  "version": 1
}
```

后端校验事件仍为 `pending`、选项属于 `allowedOptions`、选项必填参数完整以及版本未冲突。AI 解释接口暂缓，不阻塞结构化依据和决策处理。

### `GET /decision-events/{eventId}/ai-explanation:stream`

老板在拍板事件中点击“AI 解释依据”时按需调用。后端读取事件已经固化的
`evidence`、`reasonCodes`、金额、日期和 `allowedOptions`，通过 LangChain 调用
阿里云百炼 `qwen-plus`，以 SSE 返回：

```text
data: {"type":"delta","text":"一句话结论：..."}

data: {"type":"done","degraded":false}
```

AI 不参与付款排序和决策代码计算。付款建议仍由确定性规则引擎在数据发布、刷新或查询时生成；
AI 仅负责把老板拍板事件的结构化依据解释成人话。模型未配置或调用失败时返回确定性模板，
并在完成事件中标记 `degraded=true`。

## 10. 一致性与缓存

- 发布成功后，后续驾驶舱读取必须能立即读到新批次。
- 发布事务包含：锁定批次、切换当前版本、计算指标、生成任务；任一步失败则整体回滚或保持旧版本可用。
- 驾驶舱读取可使用短缓存，但缓存键必须包含 `batchId + asOfDate + ruleVersion`，发布后主动失效。
- 下载和读取原始行需要基础审计日志；不得在错误信息中返回服务器路径或堆栈。

## 11. 后续 OpenAPI 落地要求

编码时以本文生成 OpenAPI 3.1 文件，并为请求/响应建立命名 Schema。破坏性变更进入 `/api/v2`；V1 只允许新增可选字段或新增接口。
