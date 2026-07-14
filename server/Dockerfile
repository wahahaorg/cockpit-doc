# ── 阶段 1：依赖安装 ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

ARG UV_VERSION=0.11.7
RUN pip install --no-cache-dir \
    --index-url https://mirrors.aliyun.com/pypi/simple/ \
    "uv==${UV_VERSION}"

ENV UV_HTTP_TIMEOUT=120 \
    UV_HTTP_RETRIES=5

WORKDIR /app

# 先复制依赖文件，利用 Docker 层缓存
COPY pyproject.toml uv.lock ./

# 安装生产依赖到独立虚拟环境
RUN uv sync --frozen --no-dev --no-editable

# ── 阶段 2：运行时镜像 ────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

WORKDIR /app

# 从 builder 复制虚拟环境
COPY --from=builder /app/.venv /app/.venv

# 复制应用代码
COPY alembic/ ./alembic/
COPY alembic.ini ./
COPY app/ ./app/

# 让虚拟环境的 bin 优先
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

# 启动脚本：先跑迁移，再启动服务
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
