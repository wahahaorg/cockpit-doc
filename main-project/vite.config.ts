import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 后端默认跑在 http://127.0.0.1:8000。dev 下把 /api 代理过去，避免跨域 / 硬编码 base。
// 如需指向其它后端，设环境变量 VITE_API_TARGET（例如 http://10.0.0.5:8000）。
const API_TARGET = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  // 仅生产构建剥离 console / debugger（合规：不在生产打印敏感数据），dev 保留便于调试
  esbuild: command === 'build' ? { drop: ['console', 'debugger'] } : {},
}))
