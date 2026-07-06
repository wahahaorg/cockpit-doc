// 登录页：口令登录（POST /api/auth/login，口令走 body）。深色科技感统一。
import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { login, ApiError } from '../api'
import { setToken } from '../store/auth'

export function Login() {
  const [passcode, setPasscode] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  // 老板落地页 = CEO 驾驶舱首页；深链(非根)登录后回原页
  const fromState = (location.state as { from?: string } | null)?.from
  const from = fromState && fromState !== '/' ? fromState : '/'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!passcode.trim() || loading) return
    setErr('')
    setLoading(true)
    try {
      const data = await login(passcode.trim())
      setToken(data.token)
      navigate(from, { replace: true })
    } catch (e) {
      // 后端对口令错/锁定统一返回友好 message，不暴露细节
      setErr(e instanceof ApiError ? e.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="scan" />
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="logo" />
          <div>
            <h2>现金流指挥中枢</h2>
            <div className="sub">Cashflow Command</div>
          </div>
        </div>

        <label className="field-lab" htmlFor="passcode">
          访问口令 · Passcode
        </label>
        <input
          id="passcode"
          className="field-in"
          type="password"
          autoComplete="current-password"
          placeholder="输入口令进入驾驶舱"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoFocus
        />

        <div className="login-err">{err}</div>

        <button className="btn-primary" type="submit" disabled={loading || !passcode.trim()}>
          {loading ? '验证中…' : '进入指挥中枢'}
        </button>

        <div className="login-foot">
          内网单人访问 · 只读经营驾驶舱。口令仅用于本次登录，不在前端留存。
          <br />
          所有金融数字均为占位演示值，标注「待财务复核」。
        </div>
      </form>
    </div>
  )
}
