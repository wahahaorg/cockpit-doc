// 顶部状态条：品牌 + 在线脉冲 + 导航 + 降级提示 + ticker + 实时时钟。
// 高保真稿 design/index.html .topbar 复刻。
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { setUnit, useUnit } from '../store/unit'

interface Props {
  /** downgraded=true（无 LLM key / 规则模式）→ 顶部 amber 提示。 */
  downgraded?: boolean
  /** ticker：账期模型月数 */
  accountPeriodMonths?: number | null
  /** ticker：本月计划支出（已格式化字符串，如 ¥952,000） */
  plannedOutflowLabel?: string | null
  /** 当前账期月，如 "2026 · 06月账期" */
  periodLabel?: string
}

function useClock() {
  const [t, setT] = useState(() => fmt(new Date()))
  useEffect(() => {
    const id = setInterval(() => setT(fmt(new Date())), 1000)
    return () => clearInterval(id)
  }, [])
  return t
}

function fmt(d: Date) {
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

export function TopBar({
  downgraded,
  accountPeriodMonths,
  plannedOutflowLabel,
  periodLabel = '内网账期',
}: Props) {
  const clock = useClock()
  const unit = useUnit()

  return (
    <div className="topbar">
      <div className="brand">
        <div className="logo" />
        <div>
          <h1>现金流指挥中枢</h1>
          <div className="sub">Cashflow Command</div>
        </div>
      </div>
      <div className="status">
        <span className="dot" />
        系统在线 · 内网
      </div>

      <nav className="navlinks">
        <NavLink to="/" end>
          今日决策
        </NavLink>
        <NavLink to="/cashflow">现金流</NavLink>
        <NavLink to="/repayment">回款风险</NavLink>
        <NavLink to="/payments">付款判断</NavLink>
        <NavLink to="/tasks">风险任务</NavLink>
      </nav>

      <div className="spacer" />

      {downgraded && (
        <div className="degraded">
          <span>◆</span>AI 未启用 · 规则分类
        </div>
      )}

      <div className="tickers">
        <div className="tick">
          <div className="k">账期模型</div>
          <div className="v" style={{ color: 'var(--cyan)' }}>
            {accountPeriodMonths != null ? `${accountPeriodMonths} 月` : '—'}
          </div>
        </div>
        <div className="tick">
          <div className="k">本月计划支出</div>
          <div className="v">{plannedOutflowLabel ?? '—'}</div>
        </div>
      </div>

      <div className="seg" title="金额单位" aria-label="金额单位切换">
        <button className={unit === 'yuan' ? 'active' : ''} onClick={() => setUnit('yuan')}>
          元
        </button>
        <button className={unit === 'wan' ? 'active' : ''} onClick={() => setUnit('wan')}>
          万元
        </button>
      </div>

      <div className="clock">
        <div>{clock}</div>
        <div className="d">{periodLabel}</div>
      </div>
    </div>
  )
}
