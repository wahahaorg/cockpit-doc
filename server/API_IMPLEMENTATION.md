# 后台接口实现说明与 Python 调用示例

本文面向刚接触 Python 和 FastAPI 的开发者。读完后，你应该能够：

- 理解每个后台接口解决什么问题。
- 知道请求经过控制器、业务逻辑和数据库的大致过程。
- 使用 Python 代码调用接口并查看结果。

在线调试地址：<http://localhost:8000/docs#/>  
接口基础地址：`http://localhost:8000`

## 1. 调用准备

示例使用第三方 HTTP 客户端 `requests`：

```bash
python -m pip install requests
```

先准备一个公共文件，例如 `api_client.py`：

```python
import requests

BASE_URL = "http://localhost:8000"


def show_response(response):
    """打印状态码和 JSON；请求失败时抛出异常。"""
    print("HTTP 状态码:", response.status_code)
    print("响应内容:", response.json())
    response.raise_for_status()
    return response.json()
```

后面的示例默认已经导入：

```python
import requests

from api_client import BASE_URL, show_response
```

## 2. 通用实现机制

后台使用 FastAPI 接收 HTTP 请求，使用 Pydantic 检查参数和 JSON 数据，使用 SQLAlchemy 访问 PostgreSQL。

一次请求的基本过程如下：

1. FastAPI 根据请求方法和路径找到对应的接口函数。
2. FastAPI 把路径参数、查询参数、表单或 JSON 转换成 Python 数据。
3. `get_db` 为本次请求创建 SQLAlchemy `Session`。
4. 控制器查询数据库，或调用导入、发布、统计等业务函数。
5. 接口把 ORM 对象整理为 JSON 并返回，数据库会话随后关闭。

成功响应通常有两种结构：

```json
{"data": {}}
```

```json
{"data": [], "pagination": {"page": 1, "pageSize": 20, "total": 0, "totalPages": 0}}
```

业务错误使用统一格式，并带有可用于查日志的 `requestId`：

```json
{
  "error": {
    "code": "batch_not_found",
    "message": "导入批次不存在",
    "details": {},
    "requestId": "req_xxx"
  }
}
```

每个响应还会包含 `X-Request-Id` 响应头。调用方也可以主动发送同名请求头，方便串联前后端日志。

## 3. 健康检查

### 3.1 检查服务状态

**接口**

`GET /health`

**作用**

确认 FastAPI 服务已经启动并能够接收请求。

**实现原理**

接口不访问数据库，直接返回 `{"status": "ok"}`。因此它适合用于本地排障、容器健康检查或部署平台探活。

**示例代码**

```python
response = requests.get(f"{BASE_URL}/health", timeout=10)
show_response(response)
```

## 4. Excel 导入与发布

### 4.1 上传 Excel 导入批次

**接口**

`POST /api/v1/imports`

表单字段：`file`、`templateVersion`、`dataPeriodStart`、`dataPeriodEnd`。

**作用**

上传 V0.1 Excel 模板，解析四个 Sheet，并保存导入批次、原始行、标准化数据和校验结果。

**实现原理**

接口只接受 `.xlsx`，并检查文件大小、模板版本和日期范围。服务通过 SHA-256 防止同一文件重复上传。`openpyxl` 读取“账户余额、应收款、实际回款、计划支出”四个 Sheet，把日期和金额转换成统一类型，并检查必填项、负数金额、重复编号、枚举值及应收与回款的关联关系。每一行都会保留原始值、标准化值和校验消息；没有阻断错误的数据同时写入标准业务表。整个过程最后一次性提交事务。

**示例代码**

```python
form = {
    "templateVersion": "V0.1",
    "dataPeriodStart": "2026-05-01",
    "dataPeriodEnd": "2026-07-31",
}

with open("sample.xlsx", "rb") as excel_file:
    files = {
        "file": (
            "sample.xlsx",
            excel_file,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    response = requests.post(
        f"{BASE_URL}/api/v1/imports",
        data=form,
        files=files,
        timeout=60,
    )

result = show_response(response)
batch_id = result["data"]["id"]
batch_version = result["data"]["version"]
```

### 4.2 查询导入批次列表

**接口**

`GET /api/v1/imports?page=1&pageSize=20&status=pending_review`

**作用**

分页查看历史导入批次，也可以按状态筛选。

**实现原理**

SQLAlchemy 先统计符合条件的总数，再按创建时间倒序查询当前页。`offset=(page-1)*pageSize` 决定跳过多少条，`limit=pageSize` 限制返回数量。

**示例代码**

```python
params = {"page": 1, "pageSize": 20, "status": "pending_review"}
response = requests.get(f"{BASE_URL}/api/v1/imports", params=params, timeout=10)
show_response(response)
```

### 4.3 查询单个导入批次

**接口**

`GET /api/v1/imports/{batch_id}`

**作用**

查看一个批次的基本信息，以及每个 Sheet 的有效、警告和错误行数。

**实现原理**

接口先按 UUID 查找批次，再对原始导入行按 `sheet_name` 和 `validation_status` 分组计数，最后把统计结果合并到批次数据中。批次不存在时返回 404。

**示例代码**

```python
batch_id = "请替换为真实批次 UUID"
response = requests.get(f"{BASE_URL}/api/v1/imports/{batch_id}", timeout=10)
show_response(response)
```

### 4.4 查询批次原始行

**接口**

`GET /api/v1/imports/{batch_id}/rows`

可选参数：`sheetName`、`validationStatus`、`page`、`pageSize`。

**作用**

追溯 Excel 中的原始行，并对比标准化后的字段和校验消息。

**实现原理**

查询始终限定在指定批次；如果传入 Sheet 名或校验状态，就继续追加 SQL 条件。结果按 Sheet 和 Excel 行号排序后分页返回。

**示例代码**

```python
batch_id = "请替换为真实批次 UUID"
params = {
    "sheetName": "应收款",
    "validationStatus": "error",
    "page": 1,
    "pageSize": 20,
}
response = requests.get(
    f"{BASE_URL}/api/v1/imports/{batch_id}/rows",
    params=params,
    timeout=10,
)
show_response(response)
```

### 4.5 查询批次校验问题

**接口**

`GET /api/v1/imports/{batch_id}/validation-errors`

**作用**

集中查看一个批次中的所有错误和警告，便于修正 Excel。

**实现原理**

接口筛选状态为 `error` 或 `warning` 的原始行，再把每一行的 `validation_messages` 展开为扁平列表。每条问题都会附带 Sheet 名和 Excel 行号。

**示例代码**

```python
batch_id = "请替换为真实批次 UUID"
response = requests.get(
    f"{BASE_URL}/api/v1/imports/{batch_id}/validation-errors",
    timeout=10,
)
show_response(response)
```

### 4.6 发布导入批次

**接口**

`POST /api/v1/imports/{batch_id}:publish`

请求体：`version` 必填，`reviewNote` 可选。

**作用**

把审核通过的批次设置为当前正式数据，并根据逾期应收和现金缺口生成任务。

**实现原理**

发布前会检查批次是否存在、客户端版本是否仍是最新、是否存在阻断错误，以及当前状态是否允许发布。`version` 是乐观锁：若别人先修改了数据，版本不一致就返回 409，避免旧页面覆盖新结果。发布时旧的已发布批次会退回待审核，新批次版本加一并记录发布时间。随后根据风险和现金缺口生成催收或筹资任务，最后提交事务。

**示例代码**

```python
batch_id = "请替换为真实批次 UUID"
body = {
    "version": 1,  # 使用“查询单个批次”返回的最新 version
    "reviewNote": "财务数据已复核",
}
response = requests.post(
    f"{BASE_URL}/api/v1/imports/{batch_id}:publish",
    json=body,
    timeout=20,
)
show_response(response)
```

## 5. 标准数据查询

除客户列表外，本节接口默认读取当前已发布批次。传入 `batchId` 时，可以查看指定批次。金额在 JSON 中使用字符串返回，例如 `"3000000.00"`，这样可以避免浮点数精度损失。

### 5.1 查询账户余额

**接口**

`GET /api/v1/account-balances`

可选参数：`batchId`、`page`、`pageSize`。

**作用**

分页查看账户快照日期、可用余额和币种。

**实现原理**

接口先定位指定批次或当前已发布批次，再按快照日期倒序查询该批次的账户余额记录。

**示例代码**

```python
params = {"page": 1, "pageSize": 20}
response = requests.get(
    f"{BASE_URL}/api/v1/account-balances", params=params, timeout=10
)
show_response(response)
```

### 5.2 查询客户

**接口**

`GET /api/v1/customers`

可选参数：`keyword`、`page`、`pageSize`。

**作用**

分页查看有效客户，并按客户名称进行包含搜索。

**实现原理**

接口只查询 `active=true` 的客户。传入 `keyword` 后，SQL 使用 `contains` 匹配客户名称。

**示例代码**

```python
params = {"keyword": "科技", "page": 1, "pageSize": 20}
response = requests.get(f"{BASE_URL}/api/v1/customers", params=params, timeout=10)
show_response(response)
```

### 5.3 查询应收款

**接口**

`GET /api/v1/receivables`

可选参数：`batchId`、`page`、`pageSize`。

**作用**

分页查看应收编号、金额、约定到账日、责任人和业务状态。

**实现原理**

接口定位数据批次后，只查询该批次的应收表，并把 `Decimal` 金额转成字符串返回。

**示例代码**

```python
response = requests.get(
    f"{BASE_URL}/api/v1/receivables",
    params={"page": 1, "pageSize": 20},
    timeout=10,
)
result = show_response(response)

if result["data"]:
    receivable_id = result["data"][0]["id"]
    print("第一条应收款 ID:", receivable_id)
```

### 5.4 查询实际回款

**接口**

`GET /api/v1/collections`

可选参数：`batchId`、`page`、`pageSize`。

**作用**

分页查看实际回款记录及其关联的应收款。

**实现原理**

接口按数据批次过滤回款表，返回回款编号、应收款 ID、回款日期和金额。

**示例代码**

```python
response = requests.get(
    f"{BASE_URL}/api/v1/collections",
    params={"page": 1, "pageSize": 20},
    timeout=10,
)
show_response(response)
```

### 5.5 查询计划支出

**接口**

`GET /api/v1/planned-expenses`

可选参数：`batchId`、`page`、`pageSize`。

**作用**

分页查看支出名称、计划日期、金额和审批状态。

**实现原理**

接口按数据批次过滤计划支出表。返回值保留审批状态，驾驶舱计算时只统计 `planned`、`pending` 和 `approved`。

**示例代码**

```python
response = requests.get(
    f"{BASE_URL}/api/v1/planned-expenses",
    params={"page": 1, "pageSize": 20},
    timeout=10,
)
show_response(response)
```

## 6. 跟进记录与任务

### 6.1 新增应收跟进记录

**接口**

`POST /api/v1/receivables/{receivable_id}/followups`

**作用**

记录一次应收催收沟通，也可以填写下次跟进日期和承诺回款日期。

**实现原理**

Pydantic 要求 `content` 长度为 1 到 1000 个字符。接口先确认应收事项存在，再创建跟进记录；当前系统固定记录操作人为管理员。

**示例代码**

```python
receivable_id = "请替换为真实应收款 UUID"
body = {
    "content": "客户确认本周五安排付款",
    "nextFollowupDate": "2026-07-06",
    "promisedCollectionDate": "2026-07-10",
}
response = requests.post(
    f"{BASE_URL}/api/v1/receivables/{receivable_id}/followups",
    json=body,
    timeout=10,
)
show_response(response)
```

### 6.2 查询任务

**接口**

`GET /api/v1/tasks`

可选参数：`date`、`status`、`page`、`pageSize`。

**作用**

分页查看当前已发布批次产生的催收或现金缺口任务。

**实现原理**

发布批次时，系统会根据红黄风险和现金缺口生成任务。查询时限定当前批次；传入 `date` 后返回截止日期小于等于该日期的任务，传入 `status` 后按状态过滤。

**示例代码**

```python
params = {"date": "2026-07-03", "status": "pending", "page": 1}
response = requests.get(f"{BASE_URL}/api/v1/tasks", params=params, timeout=10)
result = show_response(response)

if result["data"]:
    task_id = result["data"][0]["id"]
    task_version = result["data"][0]["version"]
```

### 6.3 修改任务状态或负责人

**接口**

`PATCH /api/v1/tasks/{task_id}`

**作用**

推进任务状态，也可以重新分配负责人。

**实现原理**

任务同样使用 `version` 乐观锁。状态只能按以下方向迁移：`pending` 可进入 `in_progress`、`completed` 或 `closed`；`in_progress` 可进入 `completed` 或 `closed`；`completed` 只能进入 `closed`；`closed` 不能再改变。成功后版本加一。

**示例代码**

```python
task_id = "请替换为真实任务 UUID"
body = {
    "status": "in_progress",
    "ownerCode": "FIN-001",
    "ownerName": "张三",
    "version": 1,  # 使用任务查询返回的最新 version
}
response = requests.patch(
    f"{BASE_URL}/api/v1/tasks/{task_id}",
    json=body,
    timeout=10,
)
show_response(response)
```

## 7. 驾驶舱计算

当前计算规则标记为“待 CFO 确认”，接口结果用于数据验证，不应直接视为正式付款或经营决策。

### 7.1 查询驾驶舱总览

**接口**

`GET /api/v1/cockpit/overview?asOfDate=2026-07-03`

**作用**

返回指定日期的可用现金、本月预计和实际回款、计划支出、现金缺口、逾期金额、待办数及四张判断卡片。

**实现原理**

系统读取当前已发布批次。账户余额按每个账户在 `asOfDate` 之前的最新快照求和；本月预计回款取预计日或到期日在本月的未回金额；实际回款和计划支出按本月日期范围求和。现金缺口公式是：

```text
max(-(可用现金 + 本月剩余预计回款 - 本月剩余计划支出), 0)
```

逾期金额是已过约定到账日且尚未回收的金额之和。最后根据缺口、逾期风险和待办数生成红、黄、绿判断卡片。

**示例代码**

```python
response = requests.get(
    f"{BASE_URL}/api/v1/cockpit/overview",
    params={"asOfDate": "2026-07-03"},
    timeout=10,
)
result = show_response(response)
print("可用现金:", result["data"]["metrics"]["availableCash"])
print("现金缺口:", result["data"]["metrics"]["cashGap"])
```

### 7.2 查询应收风险

**接口**

`GET /api/v1/receivable-risks`

可选参数：`asOfDate`、`riskLevel`、`ownerCode`。

**作用**

查看每笔未关闭应收的已回金额、未回金额、逾期天数和风险等级。

**实现原理**

系统先按应收款汇总有效回款，再计算 `未回金额=max(应收金额-已回金额, 0)`。未回金额为零时逾期天数为零；否则按基准日期减约定到账日计算。逾期至少 30 天，或已逾期且未回金额达到 100 万元，为红色；其他逾期为黄色；未逾期为绿色。结果按红、黄、绿，再按逾期天数和未回金额降序排列。

**示例代码**

```python
params = {
    "asOfDate": "2026-07-03",
    "riskLevel": "red",
    "ownerCode": "FIN-001",
}
response = requests.get(
    f"{BASE_URL}/api/v1/receivable-risks", params=params, timeout=10
)
show_response(response)
```

### 7.3 试算新增支出

**接口**

`POST /api/v1/expense-simulations`

**作用**

在不写入真实支出数据的情况下，估算新增一笔支出后的现金和缺口变化。

**实现原理**

接口先计算指定日期的驾驶舱总览，再用 `可用现金-试算金额` 得到试算后现金，并用 `原现金缺口+试算金额` 得到试算后缺口。金额必须大于零。该接口只计算并返回结果，不写数据库；当前实现中的 `plannedDate`、`category` 和 `rigidity` 用于校验和保留业务语义，尚未参与公式。

**示例代码**

```python
body = {
    "asOfDate": "2026-07-03",
    "amount": "200000.00",
    "plannedDate": "2026-07-15",
    "category": "设备采购",
    "rigidity": "flexible",
}
response = requests.post(
    f"{BASE_URL}/api/v1/expense-simulations",
    json=body,
    timeout=10,
)
show_response(response)
```

## 8. 常见错误与排查

| HTTP 状态码 | 常见含义 | 处理方法 |
| --- | --- | --- |
| 404 | 批次、应收或任务不存在；或尚无已发布批次 | 检查 UUID，先上传并发布批次 |
| 409 | 文件重复、版本冲突或状态迁移不合法 | 重新查询最新数据和 `version` 后再提交 |
| 413 | 上传文件过大 | 缩小文件或调整服务端上传限制 |
| 415 | 文件不是 `.xlsx` | 使用 V0.1 的 `.xlsx` 模板 |
| 422 | 参数格式错误、模板不支持或批次有阻断错误 | 查看响应中的 `error` 或 FastAPI 的 `detail` |
| 500 | 服务端未预期异常 | 使用响应里的 `requestId` 查询服务日志 |

捕获请求错误的完整示例：

```python
import requests

from api_client import BASE_URL

try:
    response = requests.get(f"{BASE_URL}/api/v1/cockpit/overview", timeout=10)
    response.raise_for_status()
    print(response.json()["data"])
except requests.HTTPError:
    print("接口返回错误:", response.status_code, response.json())
except requests.RequestException as error:
    print("无法连接后台服务:", error)
```

## 9. 推荐学习顺序

1. 调用 `/health`，确认 Python 能连接后台。
2. 上传一个 V0.1 Excel，保存返回的批次 ID 和版本。
3. 查询批次详情、原始行和校验问题。
4. 没有阻断错误后发布批次。
5. 查询标准数据、总览、应收风险和任务。
6. 新增跟进、修改任务，并观察 `version` 如何变化。

