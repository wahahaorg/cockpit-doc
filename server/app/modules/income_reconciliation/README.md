# income_reconciliation 模块文档

## 目录

- [一、模块总览](#一模块总览)
- [二、业务流程](#二业务流程)
- [三、controller.py API 层](#三controllerpy-api-层)
- [四、service.py 核心逻辑](#四servicepy-核心逻辑)
  - [4.1 任务创建与状态管理](#41-任务创建与状态管理)
  - [4.2 文件解析](#42-文件解析)
  - [4.3 AI 提取与兜底规则](#43-ai-提取与兜底规则)
  - [4.4 三方数据核对](#44-三方数据核对)
  - [4.5 Excel 导出](#45-excel-导出)
  - [4.6 工具函数](#46-工具函数)
- [五、Python 语法与模式详解（针对 JS 背景）](#五python-语法与模式详解针对-js-背景)
  - [5.1 类型注解](#51-类型注解)
  - [5.2 装饰器](#52-装饰器)
  - [5.3 Pathlib 文件路径操作](#53-pathlib-文件路径操作)
  - [5.4 with 上下文管理器](#54-with-上下文管理器)
  - [5.5 Decimal 精确小数](#55-decimal-精确小数)
  - [5.6 解包与星号表达式](#56-解包与星号表达式)
  - [5.7 列表推导式与生成器表达式](#57-列表推导式与生成器表达式)
  - [5.8 字典合并与 `**` 解包](#58-字典合并与--解包)
  - [5.9 模块级全局变量与懒加载](#59-模块级全局变量与懒加载)
  - [5.10 异常处理](#510-异常处理)
  - [5.11 json.dumps / json.loads](#511-jsondumps--jsonloads)
  - [5.12 正则表达式 re 模块](#512-正则表达式-re-模块)
  - [5.13 时间与性能计时](#513-时间与性能计时)
  - [5.14 枚举与集合操作](#514-枚举与集合操作)
  - [5.15 next() 与迭代器](#515-next-与迭代器)
  - [5.16 is 与 == 的区别](#516-is-与--的区别)
  - [5.17 openpyxl 操作 Excel](#517-openpyxl-操作-excel)
  - [5.18 logging 日志](#518-logging-日志)
  - [5.19 文件读写策略（原子写入）](#519-文件读写策略原子写入)
  - [5.20 常见 `Any` 类型](#520-常见-any-类型)
- [六、数据流示意图](#六数据流示意图)

---

## 一、模块总览

这是一个**技术服务收入链路核对**系统，核心功能是：

1. 接收前端上传的 **开票明细 Excel**、**服务收支明细 Excel**、**结算单文件**（Excel / PDF / Word / 图片）
2. 解析三种来源的数据
3. AI（或规则兜底）从结算单中提取客户、周期、金额
4. 将"发票 ⇄ 结算单 ⇄ 到账记录"三方匹配
5. 输出一个 Excel 核对表，标注正常项和异常项

> **一句话**：让财务人员不用手动对账，系统自动把发票、结算单、银行到账三条线串起来。

---

## 二、业务流程

```
用户上传文件
    │
    ▼
POST /jobs ─────────► create_job()      保存上传文件，创建任务
    │
    ▼
POST /jobs/{id}/parse ──► parse_job()   解析三个文件
    ├── _parse_invoice_excel()     读取发票 Excel
    ├── _parse_cashflow_excel()    读取收支 Excel
    └── _parse_settlement()        处理结算单
            ├── _extract_settlement_text()  提取原始文本
            └── _extract_settlement_with_ai()  AI 抽取结构化字段
    │
    ▼
POST /jobs/{id}/generate ──► generate_job()  三方核对 + 导出
    ├── _reconcile()         发票 vs 结算单 vs 到账
    └── _export_excel()      生成 Excel 报告
    │
    ▼
GET /jobs/{id}/download ──► 下载结果文件
```

---

## 三、controller.py API 层

### 导入来源一览

```python
# 🌐 第三方依赖（FastAPI 框架）
from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import FileResponse

# 📦 项目内部模块
from app.core.exceptions import AppError
from app.modules.income_reconciliation import service

router = APIRouter(prefix="/income-reconciliation", tags=["income-reconciliation"])
```

### API 路由

| 端点 | 方法 | 函数 | 来源 | 功能 |
|---|---|---|---|---|
| `/jobs` | POST | `create_income_reconciliation_job` | 📄 本文件 | 创建核对任务，接收 multipart form |
| `/jobs/{id}/parse` | POST | `parse_income_reconciliation_job` | 📄 本文件 | 解析文件，支持后台异步 |
| `/jobs/{id}/generate` | POST | `generate_income_reconciliation_job` | 📄 本文件 | 生成核对结果 |
| `/jobs/{id}` | GET | `get_income_reconciliation_job` | 📄 本文件 | 获取任务状态 |
| `/jobs/{id}/events.json` | GET | `get_income_reconciliation_events` | 📄 本文件 | 获取进度事件 |
| `/jobs/{id}/files/{file_id}` | GET | `get_income_reconciliation_file_result` | 📄 本文件 | 单文件解析详情 |
| `/jobs/{id}/download` | GET | `download_income_reconciliation_excel` | 📄 本文件 | 下载结果 Excel |

### 工具函数（controller）

| 函数 | 来源 | 说明 |
|---|---|---|
| `_first_file(form, *keys)` | 📄 本文件 | 从 form 中取第一个上传文件 |
| `_all_files(form, *keys)` | 📄 本文件 | 从 form 中取所有匹配的上传文件 |
| `_is_upload_file(value)` | 📄 本文件 | 用 `hasattr()` 判断是否是 UploadFile |

> **标注说明**：
> - 🐍 Python 标准库（无需安装）
> - 🌐 第三方依赖（`pip install` 来的）
> - 📦 项目内部模块（`app/` 下的其他文件）
> - 📄 本文件（当前 `.py` 内自己写的）

### Python 语法要点（controller）

**`async def` 与同步函数的混用**

```python
@router.post("/jobs", status_code=201)
async def create_income_reconciliation_job(request: Request):
    form = await request.form()      # 需要 await 的异步操作
    ...
    return {"data": service.create_job(...)}   # 同步调用，不 await
```

- FastAPI 中 `request.form()` 是异步的，需要 `await`
- `service.create_job()` 是同步函数，直接调用不加 `await`
- `@router.post("/jobs/{id}/parse")` 没有 `async` → 同步端点

**`request.form()` 获取上传文件**

```python
invoice_file = _first_file(form, "invoice_file", "invoiceFile")
settlement_files = _all_files(form, "settlement_files", "settlementFiles", "settlement_files[]")
```

- 前端可能用不同的 field name 上传（snake_case 或 camelCase），后端都兼容
- `form.get()` 取单个，`form.getlist()` 取多个（一个 key 对应多个文件）

**`hasattr()` 判断文件类型**

```python
def _is_upload_file(value) -> bool:
    return hasattr(value, "filename") and hasattr(value, "file")
```

- `hasattr(obj, attr)` ≈ JS 的 `attr in obj`，检查对象是否有某属性
- 这里用来区分普通表单字段和上传文件

**`FileResponse` 返回文件下载**

```python
return FileResponse(
    path,
    filename="4-5月技术服务收入链路核对表.xlsx",
    media_type="application/vnd.openxmlformats...",
)
```

- FastAPI 内置响应类型，直接返回文件流
- 浏览器会自动识别为下载

---

## 四、service.py 核心逻辑

### 导入来源一览

```python
# ── 🐍 Python 标准库（不需要 pip install） ──
import json                # JSON 序列化/反序列化
import logging             # 日志输出
import re                  # 正则表达式
import shutil              # 文件操作（copyfileobj）
import time                # time.monotonic() 性能计时
import uuid                # 生成唯一 ID
import zipfile             # 解压 ZIP（用于读取 .docx）
from datetime import date, datetime          # 日期时间处理
from decimal import Decimal, InvalidOperation # 精确小数运算（财务金额用）
from pathlib import Path   # 跨平台路径操作
from typing import Any     # 类型注解
from xml.etree import ElementTree  # 解析 XML（用于读取 .docx）
from threading import Thread       # 后台线程

# ── 🌐 第三方依赖（pip install 来的） ──
from fastapi import UploadFile              # FastAPI 文件上传
from openpyxl import Workbook, load_workbook             # 读写 Excel
from openpyxl.styles import Font, PatternFill            # Excel 样式
# 下列模块在函数内部 import（惰性加载）：
#   fitz (pymupdf)         → 读取 PDF
#   rapidocr_onnxruntime   → 可选的本地 OCR 兜底（uv sync --extra local-ocr）

# ── 📦 项目内部模块 ──
from app.core.config import get_settings     # 获取项目配置（如存储目录）
from app.core.exceptions import AppError     # 自定义业务异常
from app.modules.ai.client import ai_available, get_chat_model  # AI 模型客户端（函数内 import）
```

### 4.1 任务创建与状态管理

#### `create_job()` — 📄 本文件

```python
def create_job(
    invoice_file: UploadFile,
    cashflow_file: UploadFile,
    settlement_files: list[UploadFile],
    period_start: str | None,
    period_end: str | None,
) -> dict[str, Any]:
```

| 调用的函数/特性 | 来源 | 说明 |
|---|---|---|
| `_save_upload()` | 📄 本文件 | 保存文件到磁盘 |
| `_write_json()` | 📄 本文件 | 写入 JSON（原子操作） |
| `_append_progress_event()` | 📄 本文件 | 写入进度事件 |
| `_reset_progress_events()` | 📄 本文件 | 重置进度事件 |
| `_safe_name()` | 📄 本文件 | 文件名安全化 |
| `get_job()` | 📄 本文件 | 返回任务元数据 |
| `Path.mkdir(parents=True, exist_ok=True)` | 🐍 pathlib | 递归创建目录 |
| `datetime.now()` | 🐍 datetime | 当前时间 |
| `uuid.uuid4().hex` | 🐍 uuid | 唯一 ID |
| `UploadFile` | 🌐 fastapi | 上传文件类型 |

**目录结构**：
```
jobs/job_20260710_143021_abc12345/
├── job.json                     # 任务元数据
├── progress.jsonl               # 进度事件流
├── uploads/
│   ├── 开票明细.xlsx
│   ├── 服务收支明细.xlsx
│   └── settlements/
│       ├── 客户A结算单.pdf
│       └── 客户B结算单.pdf
├── parsed/
│   ├── files.json               # 各文件解析状态
│   ├── invoices.json             # 发票解析结果
│   ├── cashflows.json            # 收支解析结果
│   └── settlements.json          # 结算单解析结果
├── extracted/
│   ├── texts/                    # 结算单原始文本
│   └── ai_extracts/              # AI 提取结果
└── result/
    └── reconciliation.xlsx       # 最终 Excel 报告
```

#### `get_job()` — 📄 本文件
```python
def get_job(job_id: str) -> dict[str, Any]:
```
- 调用：`_require_job()` → `_read_json("job.json")` → `_read_json("files.json")`
- `_require_job()` 内部调用 `_job_dir()` ← 📄 本文件

#### `prepare_parse_job()` — 📄 本文件
- 设置状态为 "parsing"，重置进度事件
- 用于后台异步解析的前置步骤

---

### 4.2 文件解析

#### `parse_job()` — 📄 本文件（核心入口，约 100 行）

三段式解析，按顺序依次处理三个文件类型。每段用 `try/except` 包裹，某个文件失败不影响其他文件继续解析。

| 步骤 | 函数 | 来源 | 说明 |
|---|---|---|---|
| 1 | `_parse_invoice_excel(invoice_path)` | 📄 本文件 | 读取开票明细 Excel |
| 2 | `_parse_cashflow_excel(cashflow_path)` | 📄 本文件 | 读取收支明细 Excel |
| 3 | `_parse_settlement(path, file_id, ...)` | 📄 本文件 | 处理结算单文件（循环） |
| 进度 | `_append_progress_event()` | 📄 本文件 | 实时进度更新 |
| 状态 | `_replace_file_status()` | 📄 本文件 | 更新文件解析状态 |
| 持久化 | `_write_json()` | 📄 本文件 | 写入 parsed/invoices.json 等 |

#### `_parse_invoice_excel()` — 📄 本文件

```python
def _parse_invoice_excel(path: Path) -> list[dict[str, Any]]:
```

**所用函数/库**：

| 调用 | 来源 | 作用 |
|---|---|---|
| `load_workbook(path, data_only=True)` | 🌐 openpyxl | 读取 Excel（取公式计算值） |
| `_find_sheet_header(wb, required, preferred)` | 📄 本文件 | 在所有 sheet 中找表头行 |
| `_row_dict(ws, row_no, headers)` | 📄 本文件 | 单行 → `{列名: 值}` |
| `_text()` | 📄 本文件 | 任意值 → 字符串 |
| `_date_text()` | 📄 本文件 | 日期值 → "2026-07-10" |
| `_money()` | 📄 本文件 | 金额 → Decimal 精确小数 |
| `_float()` | 📄 本文件 | Decimal → float |

**核心业务规则**：只保留 `status == "正常"` 且 `positive == "是"` 的发票（`is_effective`）

#### `_parse_cashflow_excel()` — 📄 本文件

类似发票解析，但：
- 找的表头是 `["日期", "往来单位", "收入(借方)"]`
- 只取 `amount > 0` 的行
- 不判断 is_effective（所有正数流水都算）

#### `_parse_settlement()` — 📄 本文件（结算单编排函数）

```python
def _parse_settlement(path, file_id, job_dir, progress_base=50):
```

| 步骤 | 函数 | 来源 | 说明 |
|---|---|---|---|
| 1 | `_settlement_type(path)` | 📄 本文件 | 根据后缀判断文件类型 |
| 2 | `_extract_settlement_text(path)` | 📄 本文件 | 提取原始文本 |
| 3 | `_write_text(job_dir / text_rel, text)` | 📄 本文件 | 保存提取的文本 |
| 4 | `_extract_settlement_with_ai(text, path.name)` | 📄 本文件 | AI 提取结构化字段 |
| 5 | `_money() / _float()` | 📄 本文件 | 金额标准化 |

#### `_extract_settlement_text()` — 📄 本文件

| 文件类型 | 处理方式 | 调用的函数/库 |
|---|---|---|
| `.xlsx` / `.xlsm` | 遍历所有 sheet，拼接单元格 | 🌐 `openpyxl.load_workbook` |
| `.docx` | 解压 ZIP → 读 word/document.xml → `w:t` 标签提取文本 | 🐍 `zipfile` + 🐍 `ElementTree` |
| `.pdf` | 先 `fitz.get_text()` 提取；有结算关键词则返回；否则 OCR | 🌐 `fitz` (pymupdf) |
| `.txt` / `.csv` | `Path.read_text()` 直接读 | 🐍 `pathlib` |
| `.png` / `.jpg` 等 | 优先调用远程 PaddleOCR；按配置决定是否本地兜底 | 🌐 `httpx` / 可选 `rapidocr_onnxruntime` |

#### `_docx_text()` — 📄 本文件
- 🐍 `zipfile.ZipFile` → 🐍 `ElementTree.fromstring` → `findall(".//w:t", ns)`

#### `_pdf_text()` — 📄 本文件
- 🌐 `fitz.open(path)` → `page.get_text()`（惰性导入 `import fitz` 在函数内）

#### `_pdf_text_has_settlement_detail()` — 📄 本文件
- 🐍 `re` 正则判断文本是否含结算单关键词

#### OCR 相关（`_get_ocr` / `_ocr_image` / `_ocr_pdf`） — 📄 本文件

**惰性单例模式**：
```python
_ocr_engine = None         # 模块级别量

def _get_ocr():            # 📄 本文件
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR  # 🌐 惰性导入
        _ocr_engine = RapidOCR()
    return _ocr_engine
```

| 函数 | 说明 | 关键库 |
|---|---|---|
| `_ocr_image(path)` | 单张图片 OCR | 🌐 `httpx` / 可选 `rapidocr_onnxruntime` |
| `_ocr_pdf(path)` | PDF 逐页渲染 → OCR | 🌐 `fitz` + `_ocr_image()` |

#### `_merge_text(*parts)` — 📄 本文件
- 合并多个文本源，按行去重

---

### 4.3 AI 提取

#### `_extract_settlement_with_ai()` — 📄 本文件

| 调用 | 来源 | 作用 |
|---|---|---|
| `get_settings()` | 📦 `app.core.config` | 读取模型与超时配置 |
| `ai_available()` | 📦 `app.modules.ai.client` | 检查 AI 是否可用 |
| `get_chat_model().with_structured_output(...).invoke(prompt)` | 📦 `app.modules.ai.client` | 调用 LLM 并验证结构化结果 |
| `logger.info()` | 🐍 `logging` | 性能日志 |

**流程**：
1. 检查 `ai_available()`
2. 构造 prompt → 调用带 JSON Schema 的模型
3. 验证结构化返回结果
4. AI 失败/不可用 → 标记文件解析失败，可通过重试接口再次发起 AI 抽取

---

### 4.4 三方数据核对

#### `_reconcile()` — 📄 本文件（核心）

```python
def _reconcile(invoices, cashflows, settlements) -> dict:
```

| 调用 | 来源 | 作用 |
|---|---|---|
| `_find_match()` | 📄 本文件 | 在候选列表中找匹配 |
| `_result_item()` | 📄 本文件 | 组装结果条目 |
| `Decimal(str(x))` | 🐍 decimal | 金额精确比较 |
| `set[int]` | 🐍 内置 | 记录已使用的索引 |

**匹配策略**：
```
对每张有效发票：
    → _find_match(invoice, settlements, "settlementAmount", used_settlement)
    → _find_match(invoice, cashflows, "receivedAmount", used_cashflow)
    判断组合状态
对剩余到账记录 → "未确认已到账"
对剩余结算单  → "资料缺失待确认"
```

#### `_find_match()` — 📄 本文件

| 调用 | 来源 | 作用 |
|---|---|---|
| `_norm_name()` | 📄 本文件 | 标准化客户名 |
| `Decimal(str(...))` | 🐍 decimal | 金额精确比较 |

**两步匹配**：
1. 客户名相同 + 金额差 ≤ 0.01（精确匹配）
2. 客户名相同（模糊匹配，金额可能不一致）

#### `_result_item()` — 📄 本文件
- 组装单条核对结果字典（20+ 字段）

#### `_abnormal_stage()` — 📄 本文件
- 状态 → 异常来源环节映射

---

### 4.5 Excel 导出

#### `_export_excel()` — 📄 本文件

```python
def _export_excel(path, reconciliation, files):
```

| 调用 | 来源 | 作用 |
|---|---|---|
| `Workbook()` | 🌐 openpyxl | 创建 Excel 工作簿 |
| `ws.append()` | 🌐 openpyxl | 追加行数据 |
| `wb.create_sheet("名称")` | 🌐 openpyxl | 创建新 sheet |
| `_style_header(ws, row)` | 📄 本文件 | 表头样式 |
| `_style_status_row(ws, row, status)` | 📄 本文件 | 状态行着色 |
| `wb.save(path)` | 🌐 openpyxl | 保存文件 |

**生成的 4 个 sheet**：

| Sheet 名 | 内容 |
|---|---|
| 老板卡片 | 汇总数据：确认收入总额、已到账、未到账、笔数 |
| 收入链路核对表 | 全量明细，每条记录一行，20 列 |
| 异常项清单 | 只含 `manualCheckRequired=True` 或"发票已红冲"的行 |
| 解析文件列表 | 各文件的解析状态、行数、置信度 |

#### `_style_header()` — 📄 本文件
- 🌐 `PatternFill("solid", fgColor="EAF3F6")` + 🌐 `Font(bold=True)`

#### `_style_status_row()` — 📄 本文件
- 状态→颜色映射：金额异常→红、未到账/缺失→黄、未确认→蓝、红冲→灰

---

### 4.6 辅助函数

#### Excel 表头解析

| 函数 | 来源 | 作用 |
|---|---|---|
| `_sheet(wb, preferred)` | 📄 本文件 | 取指定 sheet，没有则取第一个 |
| `_find_sheet_header(wb, required, preferred)` | 📄 本文件 | 多 sheet 中找表头行 |
| `_find_header(ws, required)` | 📄 本文件 | 单个 sheet 前 20 行找表头 |
| `_row_dict(ws, row_no, headers)` | 📄 本文件 | 行数据 → `{列名: 值}` |
| `_cell_value(value)` | 📄 本文件 | 单元格值标准化 |

#### 文件路径与任务校验

| 函数 | 来源 | 作用 |
|---|---|---|
| `_job_dir(job_id)` | 📄 本文件 | 拼接任务目录路径 |
| `_require_job(job_id)` | 📄 本文件 | 校验任务存在 |
| `_save_upload(file, target)` | 📄 本文件 | 保存上传文件（`seek(0)` + `shutil.copyfileobj`） |
| `_safe_name(name)` | 📄 本文件 | 文件名安全化（`Path(name).name`） |

#### JSON / 文本读写

| 函数 | 来源 | 作用 | 技术点 |
|---|---|---|---|
| `_write_json(path, data)` | 📄 本文件 | 原子写入 JSON | `uuid` 临时文件 → `Path.replace()` |
| `_read_json(path, default)` | 📄 本文件 | 读取 JSON | 自动处理空文件/损坏 |
| `_write_text(path, text)` | 📄 本文件 | 写文本文件 | |
| `_read_text(path)` | 📄 本文件 | 读文本文件 | 文件不存在返回 `""` |

#### 进度事件管理

| 函数 | 来源 | 作用 |
|---|---|---|
| `get_progress_events(job_id)` | 📄 本文件 | 读取任务进度事件 |
| `get_progress_events_for_dir(job_dir)` | 📄 本文件 | 按目录读进度事件 |
| `_reset_progress_events(job_dir)` | 📄 本文件 | 清空进度事件 |
| `_append_progress_event(job_dir, type, msg, **payload)` | 📄 本文件 | 追加进度事件 |

#### 文件解析状态

| 函数 | 来源 | 作用 |
|---|---|---|
| `_initial_file_statuses(metadata)` | 📄 本文件 | 生成初始状态列表 |
| `_replace_file_status(files, status)` | 📄 本文件 | 更新文件状态 |
| `_file_status(file_id, ...)` | 📄 本文件 | 构造文件状态字典 |
| `_settlement_type(path)` | 📄 本文件 | 后缀 → 类型名 |
| `_standard_json_for_file(job_dir, file_id, type)` | 📄 本文件 | 获取已解析 JSON |

#### 类型转换工具

| 函数 | 来源 | 作用 | 依赖 |
|---|---|---|---|
| `_text(value)` | 📄 本文件 | 任意值 → 字符串 | 🐍 `str()` |
| `_money(value)` | 📄 本文件 | 金额 → Decimal | 🐍 `Decimal`（`InvalidOperation` 异常处理） |
| `_float(value)` | 📄 本文件 | Decimal → float(2位) | 🐍 `Decimal.quantize()` |
| `_date_text(value)` | 📄 本文件 | 日期 → "2026-07-10" | 🐍 `datetime.isoformat()` + `re` |
| `_month_text(value)` | 📄 本文件 | 日期 → "2026-07" | 🐍 `datetime` + `re` |
| `_norm_name(value)` | 📄 本文件 | 客户名标准化 | 🐍 `re.sub()` |

#### 正则匹配工具

| 函数 | 来源 | 作用 |
|---|---|---|
| `_match_first(text, patterns)` | 📄 本文件 | 依次尝试多个 `re.search()`，返回第一个结果 |

### 其他被引用但不在本文件的模块

| 引用路径 | 来源 | 文件位置 | 作用 |
|---|---|---|---|
| `app.core.config.get_settings` | 📦 项目内部 | `app/core/config.py` | 返回全局配置（存储目录、AI 模型等） |
| `app.core.exceptions.AppError` | 📦 项目内部 | `app/core/exceptions.py` | 业务异常，FastAPI 自动转 JSON 错误响应 |
| `app.modules.ai.client.ai_available` | 📦 项目内部 | `app/modules/ai/client.py` | 判断 AI 是否可用 |
| `app.modules.ai.client.get_chat_model` | 📦 项目内部 | `app/modules/ai/client.py` | 获取 AI 聊天模型 |
| `ai_available` / `get_chat_model` | 📦 项目内部 | 函数内 import | AI 客户端（Ollama 等） |

---

## 五、Python 语法与模式详解（针对 JS 背景）

> 如果你习惯 JS，这部分涵盖了本模块中最容易困惑的 Python 语法点。

### 5.1 类型注解

```python
def create_job(
    invoice_file: UploadFile,
    period_start: str | None = None,   # Python 3.10+ 联合类型
) -> dict[str, Any]:
```

| Python | JS 类比 | 说明 |
|---|---|---|
| `name: str` | `name` (无类型) | 参数类型注解 |
| `-> dict[str, Any]` | 无 | 返回值类型注解 |
| `str \| None` | `string \| null` | 联合类型（Python 3.10+） |
| `list[int]` | `number[]` | 泛型列表 |
| `dict[str, Any]` | `Record<string, any>` | 泛型字典 |
| `Any` | `any` | 任意类型 |

> **注意**：Python 类型注解不强制检查，它是给开发者看 + IDE 做提示用的。

#### 5.1.1 特殊格式：`type hint` 与默认值

```python
# JS: function foo(name, count = 0) {}
def foo(name: str, count: int = 0) -> str:
    ...
```

`period_start: str | None = None` 表示：参数类型可以是 str 或 None，不传时默认 None。

#### 5.1.2 `Any` 的滥用

本模块大量使用 `dict[str, Any]` 和 `list[dict[str, Any]]`，是因为代码以字典为核心而非定义类。在大型 Python 项目中通常用 `dataclass` 或 `TypedDict`，但这里为了灵活性全部用裸字典。

```python
# 相当于 JS 的:
# type InvoiceRow = Record<string, any>;
# let rows: InvoiceRow[] = [];
```

### 5.2 装饰器

```python
@router.post("/jobs", status_code=201)
async def create_income_reconciliation_job(...):
    ...
```

`@router.post(...)` 是**装饰器**语法，等价的 JS：

```js
// JS 中类似：
router.post("/jobs", { statusCode: 201 }, async function(req, res) {
    ...
});
```

Python 装饰器 `@decorator` 等价于：

```python
func = decorator(func)       # @decorator 就是 func = decorator(func)
# 带参数时：
@router.post("/jobs")        # 先调用 router.post("/jobs") 返回一个装饰器
def handler(...): ...        # 再用那个装饰器装饰 handler
```

### 5.3 Pathlib 文件路径操作

```python
from pathlib import Path

job_dir = Path("/some/path") / "jobs" / job_id    # 用 / 拼接路径
(job_dir / "uploads").mkdir(parents=True, exist_ok=True)   # 创建目录
path.suffix        # ".pdf"  ≈ path.extname in JS
path.stem          # "文件名" ≈ path.basename(path, ext)
path.name          # "文件名.pdf" ≈ path.basename
path.read_text()   # 读文本
path.write_text()  # 写文本
path.exists()      # 判断是否存在
path.is_file()     # 是否是文件
```

**`Path / Path / str`**：`/` 运算符被重载用于拼接路径，比 `os.path.join()` 更直观。

### 5.4 with 上下文管理器

```python
with target.open("wb") as out:
    shutil.copyfileobj(file.file, out)
```

等价于：

```python
out = target.open("wb")
try:
    shutil.copyfileobj(file.file, out)
finally:
    out.close()
```

`with` 自动管理资源的打开和关闭，类似 JS 的 `using` 或 `try-finally`。

常见用法：

```python
with open("file.txt", "r") as f:
    content = f.read()
# 自动 f.close()

with zipfile.ZipFile(path) as zf:
    xml = zf.read("word/document.xml")
# 自动 zf.close()
```

### 5.5 Decimal 精确小数

```python
from decimal import Decimal, InvalidOperation

MONEY_TOLERANCE = Decimal("0.01")

amount = _money(raw.get("价税合计"))
# _money 内部：return Decimal(str(value).replace(",", "").strip())
```

**为什么不用 float？**

```python
# JS: 0.1 + 0.2 = 0.30000000000000004 ❌
# Python float 同样问题
# Decimal: Decimal("0.1") + Decimal("0.2") = Decimal("0.3") ✅
```

金融计算必须用 `Decimal`，本模块凡是涉及金额的地方都用 `Decimal` 运算，只在导出时转 `float`。

注意：`Decimal` 需要用**字符串**构造，`Decimal(0.1)` 会继承 float 的精度损失。

### 5.6 解包与星号表达式

```python
for index, item in enumerate(candidates, start=1):
    ...

# _match_first 返回元组时解包
if isinstance(period_raw, tuple):
    period = f"{period_raw[0]}-{int(period_raw[1]):02d}"

# *keys 收集多个位置参数
def _first_file(form, *keys: str) -> UploadFile | None:
    for key in keys:
        ...
```

| Python | JS 类比 |
|---|---|
| `*args` | `...args` (rest params) |
| `**kwargs` | 无直接等价，≈ 收集命名参数 |
| `a, b, c = [1, 2, 3]` | `const [a, b, c] = [1, 2, 3]` |
| `a, *rest = [1, 2, 3]` | `const [a, ...rest] = [1, 2, 3]` |

### 5.7 列表推导式与生成器表达式

```python
# 列表推导式 [expr for item in iterable if condition]
# JS: candidates.filter(c => !used.has(c))
unused = [item for item in candidates if index not in used_settlement]

# 筛选 + 转换
# JS: items.filter(i => i.isEffective).map(i => i.invoiceAmount)
confirmed = sum(
    Decimal(str(i.get("invoiceAmount") or 0))
    for i in items
    if i.get("invoiceAmount") and i["status"] != "发票已红冲"
)
# 注意：这个不是列表推导式，是生成器表达式（把 [] 换成了 ()，甚至 () 都可以省略）
```

两种写法对比：

```python
# 列表推导式 —— 立即生成完整列表
squares = [x * x for x in range(10)]

# 生成器表达式 —— 惰性求值，省内存
squares = (x * x for x in range(10))   # 外层是 () 而不是 []
sum(x * x for x in range(10))          # 作为函数参数时 () 可省略
```

### 5.8 字典合并与 `**` 解包

```python
event = {
    "seq": len(events) + 1,
    "type": event_type,
    "message": message,
    **payload,          # 把 payload 字典展开合并
}

# 也可以用 | 运算符（Python 3.9+）
merged = {"a": 1} | {"b": 2}   # {"a": 1, "b": 2}
# 等价于 JS 的 {...obj1, ...obj2} 合并
```

### 5.9 模块级全局变量与懒加载

```python
_ocr_engine = None

def _get_ocr():
    global _ocr_engine                # 声明要修改全局变量
    if _ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr_engine = RapidOCR()      # 首次调用时才初始化
    return _ocr_engine
```

**模式说明**：
- `global _ocr_engine` ≈ JS 模块顶层的 `let ocrEngine = null`，然后在函数里赋值
- **懒加载（Lazy Loading）**：OCR 引擎初始化成本高，第一次用到时才创建
- 注意：`global` 只在**赋值**时需要声明；读取全局变量不需要

### 5.10 异常处理

```python
try:
    invoice_rows = _parse_invoice_excel(invoice_path)
except Exception as exc:
    logger.exception("...")           # 自动记录堆栈
    _replace_file_status(files, _file_status(..., "failed", ..., str(exc)))
```

| Python | JS 类比 |
|---|---|
| `try:` | `try {` |
| `except Exception as exc:` | `catch (exc) {` |
| `finally:` | `finally {` |
| `raise Exception("msg")` | `throw new Error("msg")` |
| `logger.exception(...)` | `console.error(...)` + 自动堆栈 |

模块自定义异常：`AppError` 会被 FastAPI 异常处理器捕获，返回 JSON。

### 5.11 json.dumps / json.loads

```python
import json

# 写 JSON
json.dumps(data, ensure_ascii=False, indent=2)
# ensure_ascii=False → 中文不转义 \uXXXX
# indent=2 → 格式化输出

# 读 JSON
json.loads(content)          # 字符串 → Python 对象
```

| Python | JS |
|---|---|
| `json.dumps(obj)` | `JSON.stringify(obj)` |
| `json.loads(str)` | `JSON.parse(str)` |

### 5.12 正则表达式 re 模块

```python
import re

re.search(pattern, text)       # 搜索第一个匹配，类似 JS regex.exec()
re.match(r"^\d{4}", text)      # 从头匹配（不需要 ^ 也会从开头匹配）
re.sub(pattern, replacement, text)  # 替换，类似 JS str.replace(regex, repl)
re.findall(pattern, text)      # 找所有匹配

# re.search 的匹配对象
match = re.search(r"名称[:：]\s*([^\n\r]+)", text)
if match:
    match.group(0)     # 完整匹配
    match.group(1)     # 第一个捕获组
    match.groups()     # 所有捕获组的元组
```

**re.S / re.DOTALL**：让 `.` 匹配换行符：

```python
re.search(r"\{.*\}", text, re.S)   # 跨行匹配 {}
```

**`re.sub` 清除模式**：

```python
text = re.sub(r"^(?:20\d{2}[-_])?", "", text)
# 移除开头的 "2026-" 或 "2026_"
```

### 5.13 时间与性能计时

```python
import time

started_at = time.monotonic()          # 开机以来的秒数（单调递增）
elapsed_ms = int((time.monotonic() - started_at) * 1000)
```

- `time.monotonic()` 用于**测量耗时**，不受系统时间调整影响
- `datetime.now().isoformat()` → `"2026-07-10T14:30:21.123456"` 用于日志
- `datetime.now():%Y%m%d_%H%M%S` → `"20260710_143021"` 用于文件名

### 5.14 枚举与集合操作

```python
# enumerate() 同时取索引和值（start 指定起始值）
for index, name in enumerate(metadata.get("settlementFiles", []), start=1):
    ...

# set 用于记录已使用的记录
used_cashflow: set[int] = set()
used_cashflow.add(index)
if index in used_cashflow:    # 判断是否已用
    continue
```

| Python | JS |
|---|---|
| `enumerate(arr)` | `arr.entries()` |
| `set()` | `new Set()` |
| `s.add(x)` | `s.add(x)` |
| `x in s` | `s.has(x)` |

### 5.15 next() 与迭代器

```python
file = next((f for f in files if f["fileId"] == file_id), None)
# 等价于 JS: files.find(f => f.fileId === file_id) ?? null
```

`next(iterator, default)` 从迭代器中取下一个值，没有则返回 default。

### 5.16 is 与 == 的区别

```python
if value is None:     # 判断 None（单例）
if status == "成功":   # 判断值相等
```

| Python | JS |
|---|---|
| `value is None` | `value === null` |
| `value == other` | `value == other` (但 Python 不自动类型转换) |
| `value is True` | `value === true` |

**规则**：
- `is` 比较**身份**（内存地址），用于 None、True、False
- `==` 比较**值**
- 不要 `is` 比较字符串或数字

### 5.17 openpyxl 操作 Excel

```python
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill

# 读取
wb = load_workbook(path, data_only=True)
ws = wb["Sheet1"]
value = ws.cell(row, col).value

# 写入
wb = Workbook()
ws = wb.active
ws.title = "老板卡片"
ws.append(["指标", "金额/数量"])     # 追加一行
ws.column_dimensions["A"].width = 20  # 设置列宽
wb.save(path)

# 样式
PatternFill("solid", fgColor="FDE2E2")   # 背景色
Font(bold=True)                           # 加粗
```

**`data_only=True`**：读取公式计算后的值，不是公式本身。

### 5.18 logging 日志

```python
import logging
logger = logging.getLogger(__name__)

logger.info("income_reconciliation_parse_started job_id=%s", job_id)
logger.warning("...")
logger.error("...")
logger.exception("...")    # 自动记录异常堆栈
```

**日志规范**：
- 用 `name=value` 格式方便日志系统解析：`"job_id=%s file=%s" % (job_id, name)`
- 事件名统一前缀 `income_reconciliation_`
- `logger.exception()` 只在 `except` 块中使用，会自动追加 traceback

### 5.19 文件读写策略（原子写入）

```python
def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
```

**为什么先写临时文件再 rename？**

如果直接写 `path`，写入过程中程序崩溃 → 文件损坏（内容只有一半）。

策略：
1. 写到一个临时文件（UUID 防冲突）
2. `tmp.replace(path)` 是**原子操作**（操作系统保证）
3. 要么写入成功，要么原文件保持不变

> 类似 JS 的 `writeFileSync(path, data, { atomic: true })` 或先写 `.tmp` 再 `rename`。

### 5.20 常见 `Any` 类型

```python
from typing import Any
```

`Any` 告诉类型检查器"可以是任何类型，别管我"。在本模块中大量使用，因为数据来自 JSON / Excel / AI 响应，类型不确定。

更规范的做法是定义 `TypedDict`：

```python
from typing import TypedDict

class InvoiceRow(TypedDict):
    invoiceNo: str
    customerName: str
    amount: float
```

但本模块为了简洁全部用了 `dict[str, Any]`。

---

## 六、数据流示意图

```
                    ┌─────────────────────┐
                    │   结算单文件          │
                    │  (xlsx/pdf/docx/图片)  │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │  _extract_settlement │
                    │  _text()             │
                    │  OCR / 文本提取       │
                    └─────────┬───────────┘
                              │ 原始文本
                    ┌─────────▼───────────┐
                    │  _extract_settlement │
                    │  _with_ai()          │ ← AI 失败时走 _heuristic_*
                    │  LLM → JSON          │
                    └─────────┬───────────┘
                              │ records[]
                    ┌─────────▼───────────┐
                    │  settlements.json    │
                    └─────────┬───────────┘
                              │
       invoices.json ──► ┌────▼────┐ ◄── cashflows.json
                         │         │
                         │ _reconcile() │
                         │         │
                         └────┬────┘
                              │
                    ┌─────────▼───────────┐
                    │  reconciliation.json │
                    │  +  summary          │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │ _export_excel()      │
                    │ → reconciliation.xlsx│
                    └─────────────────────┘
```

---

*最后更新：2026-07-10*
