# CEO 现金流驾驶舱 V3

当前仓库用于“真实样本验证”阶段：通过固定 Excel 模板导入财务样本，校验后整批发布，并为 CEO 驾驶舱、回款风险和今日清单提供统一数据基础。

## 目录

- `server/`：FastAPI、SQLAlchemy、Alembic、Excel 解析与指标 API
- `admin/`：Umi Max + Ant Design 数据验证工作台
- `main-project/`：现有 CEO 驾驶舱前端 Demo
- `output/`：V0.1 财务样本 Excel 模板
- `doc/`：表结构、字段字典、计算规则和 API 设计

## 启动

```bash
docker compose -f server/docker-compose.yml up -d

cd server
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

另开终端启动管理端：

```bash
cd admin
pnpm install
pnpm run dev
```

- 后端接口文档：`http://127.0.0.1:8000/docs`
- 管理端：以 Umi 启动日志中的本地地址为准
- PostgreSQL 数据库：`cockpit`

## 验证

```bash
cd server && uv run pytest
cd admin && pnpm run typecheck && pnpm run build
```

当前公式和风险阈值均为 V3 验证口径，仍需 CFO 确认后才能作为正式经营结论。
