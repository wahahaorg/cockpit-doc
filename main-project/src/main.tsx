import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts' // 本地字体（@fontsource）—— 内网零外网依赖
import './styles/tokens.css' // 设计系统 tokens + 全局样式
import './lib/charts' // Chart.js 全局注册 + 暗色默认
import { App } from './App'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
