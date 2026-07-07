# ── 阶段 1：构建 ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# 先复制依赖文件
COPY package.json pnpm-lock.yaml ./
# admin 用了 pnpm workspace，workspace 配置也需要复制
COPY pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

# 复制源码并构建
COPY . .
RUN pnpm build

# ── 阶段 2：Nginx 静态服务 ────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/app.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
