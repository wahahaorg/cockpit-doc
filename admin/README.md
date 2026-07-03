# 现金流数据验证工作台

V3 管理端，基于 Umi 4 + TypeScript + Ant Design。默认请求 `/api/v1`，开发代理指向 `http://127.0.0.1:8000`。

```bash
pnpm install
pnpm run dev
```

环境变量参考 `.env.example`：

- `UMI_APP_API_BASE`：API 基础路径。
- `UMI_APP_ENABLE_MOCK_FALLBACK`：后端不可用时是否回退到只读脱敏演示数据，默认关闭。
- `API_PROXY_TARGET`：开发代理目标。

验证：`pnpm run typecheck && pnpm run build`。
