# CEO 现金流驾驶舱 V3 后端

## 启动

数据库使用 PostgreSQL 的 `cockpit` 库。首次运行：

```bash
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

接口文档：`http://localhost:8000/docs`，健康检查：`GET /health`。

面向 Python 初学者的接口实现说明和调用示例见 [后台接口实现说明与 Python 调用示例](API_IMPLEMENTATION.md)。

## V3 范围

- 固定 V0.1 Excel 模板导入、逐行校验和原始行追溯
- 批次列表、详情、错误查看和整批发布
- 账户余额、客户、应收、回款、计划支出预览
- 驾驶舱指标、回款风险、今日任务、跟进和支出试算
- LangChain 接入阿里云百炼 `qwen-plus`，按需流式解释老板拍板依据
- 金额统一使用 `Decimal`；所有规则标记为待 CFO 确认

AI 未配置时接口仍可使用，会返回基于结构化依据生成的固定模板。启用时在 `.env` 中设置
`AI_ENABLED=true`、`DASHSCOPE_API_KEY` 和对应业务空间的 `DASHSCOPE_BASE_URL`。

运行测试：`uv run pytest`。
