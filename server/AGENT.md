# CEO 现金流驾驶舱后端工程约定

## 1. 技术方向

- 后端采用 Python + FastAPI。
- 数据校验和 API Schema 使用 Pydantic。
- 数据持久化使用 SQLAlchemy，数据库变更使用 Alembic 管理。
- AI 助手采用轻量 LangChain Agent；当前阶段不引入 LangGraph、多 Node 状态机或复杂工作流。
- 架构借鉴 NestJS 的 Controller、Service、Repository 分层，但保持 Python/FastAPI 的轻量特性。

## 2. 目标目录结构

目录按需创建，不为尚未实现的功能提前生成空文件。

```text
server/
├── AGENT.md
├── pyproject.toml
├── alembic.ini
├── alembic/
│   └── versions/
├── app/
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   ├── security.py
│   │   ├── exceptions.py
│   │   └── logging.py
│   ├── database/
│   │   ├── base.py
│   │   ├── session.py
│   │   └── transaction.py
│   ├── modules/
│   │   ├── cashflow/
│   │   ├── data_import/
│   │   ├── dashboard/
│   │   ├── company/
│   │   ├── auth/
│   │   └── agent/
│   ├── clients/
│   └── workers/
├── scripts/
└── tests/
    ├── unit/
    ├── integration/
    ├── evaluation/
    └── fixtures/
```

## 3. 总体组织原则

采用“公共基础设施按技术能力分层，业务代码按领域模块聚合”的方式：

- `core/`、`database/`、`clients/`、`workers/` 存放跨业务模块共享的技术能力。
- `modules/` 按业务领域组织代码，不使用全局的 `controllers/`、`services/`、`repositories/`、`models/` 目录。
- 同一业务的接口、规则、数据访问和模型应尽量放在同一个模块中。
- 模块之间通过公开的 Service 协作，不直接访问其他模块的 Repository。

## 4. 标准业务模块结构

模块根据实际需要选用下列文件，不要求每个模块机械地创建全部文件。

```text
app/modules/<module_name>/
├── controller.py      # FastAPI 路由与 HTTP 边界
├── service.py         # 业务规则与用例编排
├── repository.py      # 数据访问与持久化
├── schemas.py         # Pydantic 请求、响应与校验模型
├── models.py          # SQLAlchemy 数据库模型
├── entities.py        # 与 API、数据库无关的领域对象（按需）
├── dependencies.py    # 模块依赖组装（按需）
└── exceptions.py      # 模块领域异常（按需）
```

复杂财务模块可以增加专用文件，例如：

```text
app/modules/cashflow/
├── controller.py
├── service.py
├── repository.py
├── schemas.py
├── models.py
├── entities.py
└── calculators.py
```

数据接入模块可以增加：

```text
app/modules/data_import/
├── controller.py
├── service.py
├── repository.py
├── schemas.py
├── models.py
├── parsers.py
└── validators.py
```

## 5. 各层职责

### Controller

- 定义路由、HTTP 方法、状态码和接口文档。
- 接收并校验请求参数，调用 Service，返回响应。
- 通过 FastAPI `Depends` 接入鉴权、数据库会话等依赖。
- 不编写财务规则，不直接访问数据库，不直接调用 Repository。

### Service

- 承担业务规则、业务流程和跨 Repository/Service 的编排。
- 控制用例级事务边界。
- 正式金额、风险等级和指标口径必须由确定性 Service 或 Calculator 计算。
- 不写原生 SQL，不承载 HTTP 状态码或 FastAPI 响应对象。

### Repository

- 封装数据库查询、保存、更新和删除操作。
- 输入和输出应保持明确、可测试。
- 不处理 HTTP，不编写财务规则，不调用 Controller。
- Repository 不应直接提交破坏上层事务边界的事务，提交策略由统一约定控制。

### Schemas

- 使用 Pydantic 定义 API 请求、响应和必要的数据校验模型。
- Schema 是接口边界，不等同于数据库 Model，也不默认等同于领域 Entity。
- 不在 Schema 中实现复杂业务规则。

### Models

- 使用 SQLAlchemy 定义数据库表映射和关系。
- Model 只表达持久化结构，不承担接口序列化和复杂业务计算。

### Entities

- 表达与 HTTP、FastAPI、数据库 Session 无关的领域概念和业务不变量。
- 仅在存在复杂规则、状态变化或需要隔离数据库模型时创建。
- 简单增删改查模块不必创建 `entities.py`。
- 优先使用 `dataclass` 或普通 Python 类型；只有确有运行时校验需求时才使用 Pydantic。

### Calculators

- 放置可重复、确定性的财务计算规则。
- 输入输出明确，尽量保持无副作用，并提供单元测试。
- 禁止由大模型代替 Calculator 计算正式财务金额。

## 6. 标准调用链路

普通 API：

```text
HTTP Request
    -> FastAPI Middleware / Depends
    -> Controller
    -> Service
    -> Repository
    -> SQLAlchemy Model / Database
    -> Service
    -> Controller
    -> HTTP Response
```

复杂财务计算：

```text
Controller -> Service -> Repository -> Entity / Calculator -> Service
```

跨模块调用：

```text
DashboardService -> CashflowService -> CashflowRepository
```

禁止：

```text
DashboardService -> CashflowRepository
Controller -> Repository
```

## 7. Agent 模块

当前 Agent 保持单层 LangChain 编排：

```text
app/modules/agent/
├── controller.py      # AI 问答接口
├── service.py         # LangChain Agent 调用与编排
├── tools.py           # 业务 Service 的 Tool 封装
├── schemas.py         # 问题、答案、引用等接口结构
├── dependencies.py    # LLM、Tools 和 Agent 组装
└── prompts.py         # 财务助手 Prompt
```

调用链路：

```text
AgentController -> AgentService -> Tool -> BusinessService -> Repository
```

Agent 约束：

- Agent 负责理解问题、选择工具和组织答案。
- Tool 只能调用业务 Service，不得直接调用 Repository 或执行任意 SQL。
- Agent 不得自行推测、修改或计算正式财务金额。
- Agent 不得绕过权限、租户和数据范围校验。
- 只有出现明确的分支流程、循环纠错、人工审批或持久化状态需求时，才评估引入 LangGraph。

## 8. 公共基础设施

### Core

- `config.py`：环境变量和应用配置。
- `security.py`：认证、授权和密码/JWT 等安全能力。
- `exceptions.py`：全局异常类型与响应映射。
- `logging.py`：结构化日志和敏感信息脱敏。

### Database

- `base.py`：SQLAlchemy 声明基类和模型注册。
- `session.py`：Engine、Session 工厂和 FastAPI 数据库依赖。
- `transaction.py`：需要时提供统一事务工具。

### Clients

- 封装大模型、对象存储等外部系统客户端。
- 业务模块不得散落初始化外部 SDK。
- 客户端配置、超时、重试和错误转换应集中管理。

### Workers

- 承担 Excel/CSV 导入、批量清洗、耗时重算等后台任务。
- Worker 调用业务 Service，不复制业务规则。
- V1.0 没有真实异步任务需求时，不提前引入任务队列。

## 9. 财务领域硬性约束

- 所有金额使用 `Decimal`，禁止使用 `float` 进行正式金额计算。
- 财务指标必须有明确口径、输入来源和计算公式。
- 正式结果由确定性代码产生，大模型只负责解释和交互。
- 导入数据必须保留来源、批次、时间和校验状态，以支持追溯。
- 数据库变更必须通过 Alembic migration，禁止只改 ORM Model。
- 涉及公司或租户数据的查询必须显式限制数据范围。

## 10. 测试约定

- `tests/unit/`：Entity、Calculator、Service 等纯业务测试。
- `tests/integration/`：Repository、数据库、API 和外部客户端集成测试。
- `tests/evaluation/`：Agent 问答质量、工具选择和事实一致性回归评估。
- `tests/fixtures/`：经过脱敏的测试数据和公共夹具。
- 修改财务公式时必须同步修改或增加对应测试。

## 11. 实施原则

- 先实现最小可用模块，再根据真实重复代码抽象。
- 不预先创建 `BaseService`、`BaseRepository` 等通用基类。
- 优先复用现有模块和公共能力，不制造同义工具函数。
- 不为追求目录完整而创建空文件。
- 新增依赖前先确认标准库和现有依赖是否已经满足需求。
- 保持依赖方向单向，禁止循环依赖。
