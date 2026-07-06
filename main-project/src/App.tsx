// 应用路由。当前为内网直达模式，不需要登录。
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Actions } from './pages/Actions'
import { Dashboard } from './pages/Dashboard'
import { Review } from './pages/Review'
import { Config } from './pages/Config'
import { Dispatch } from './pages/Dispatch'
import { Approval } from './pages/Approval'
import { Repayment } from './pages/Repayment'
import { Copilot } from './pages/Copilot'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/tasks" element={<Actions />} />
        <Route path="/actions" element={<Actions />} />
        <Route path="/cashflow" element={<Dashboard />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/review" element={<Review />} />
        <Route path="/rules" element={<Config />} />
        <Route path="/config" element={<Config />} />
        <Route path="/dispatch" element={<Dispatch />} />
        <Route path="/payments" element={<Approval />} />
        <Route path="/approval" element={<Approval />} />
        <Route path="/repayment" element={<Repayment />} />
        <Route path="/copilot" element={<Copilot />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
