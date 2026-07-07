import Decimal from 'decimal.js'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  cashflowForecast,
  listDecisionEvents,
  paymentRecommendationExplanation,
  paymentRecommendationTop3,
  receivableRiskTop3,
  streamDecisionExplanation,
} from '../api'
import type {
  CashflowForecastResp,
  CashflowWindow,
  DecisionEvent,
  PaymentRecommendation,
  PaymentRecommendationTopResp,
  ReceivableRiskTopResp,
} from '../api/types'
import { TopBar } from '../components/TopBar'
import { ErrorState, Loading } from '../components/StateBox'
import { moneyU } from '../lib/format'
import { useUnit } from '../store/unit'

interface DashData {
  forecast: CashflowForecastResp
  risks: ReceivableRiskTopResp
  payments: PaymentRecommendationTopResp
  decisions: DecisionEvent[]
}

interface DecisionItem {
  id: string
  tone: 'red' | 'amber' | 'green'
  title: string
  impact: string
  reason: string
  owner: string
  deadline: string
  suggestion: string
  link: string
}

const TONE = {
  red: { color: 'var(--red)', border: 'rgba(255,84,112,.35)' },
  amber: { color: 'var(--amber)', border: 'rgba(245,181,68,.34)' },
  green: { color: 'var(--green)', border: 'rgba(53,214,154,.32)' },
}

const PAYMENT_LABEL: Record<PaymentRecommendation['decision'], string> = {
  boss_review: '老板拍板',
  defer: '暂缓',
  needs_evidence: '补充依据',
  not_ready: '未就绪',
  pay: '可付',
}

const REASON_LABEL: Record<string, string> = {
  overdue_30_days: '逾期已超过 30 天',
  overdue_large_amount: '大额回款逾期',
  overdue_under_30_days: '回款已经逾期',
  due_within_2_days: '回款即将到期',
  cash_gap_increased: '付款后现金缺口扩大',
  rigid_expense_cash_gap: '刚性支出影响现金安全',
  deferrable_expense_cash_gap: '非刚性支出影响现金安全',
  missing_required_fields: '付款资料不完整',
}

function today(): string {
  return new Date().toLocaleDateString('sv-SE')
}

function formatDate(value: string | null): string {
  if (!value) return '待确认'
  const [, month, day] = value.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function reasonText(codes: string[], fallback: string): string {
  const labels = codes.map((code) => REASON_LABEL[code]).filter(Boolean)
  return labels.length ? labels.join('；') : fallback
}

export function Dashboard() {
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    const asOfDate = today()
    try {
      const [forecast, risks, payments, decisions] = await Promise.all([
        cashflowForecast(asOfDate),
        receivableRiskTop3(asOfDate),
        paymentRecommendationTop3(asOfDate),
        listDecisionEvents(asOfDate),
      ])
      setData({ forecast, risks, payments, decisions })
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (loading) {
    return (
      <>
        <TopBar periodLabel="实时滚动预测" />
        <div className="wrap">
          <div className="panel">
            <Loading msg="正在计算经营风险…" />
          </div>
        </div>
      </>
    )
  }

  if (err || !data) {
    return (
      <>
        <TopBar periodLabel="实时滚动预测" />
        <div className="wrap">
          <div className="panel">
            <ErrorState
              msg={err || '加载失败'}
              sub="请确认后端已启动 (127.0.0.1:8000) 且已有已发布数据批次"
              onRetry={load}
            />
          </div>
        </div>
      </>
    )
  }

  return <DashboardView data={data} onReload={load} />
}

function DashboardView({ data, onReload }: { data: DashData; onReload: () => void }) {
  const unit = useUnit()
  const { forecast, risks, payments } = data
  const plannedOutflow = useMemo(
    () => forecast.daily.reduce((sum, point) => sum.plus(point.plannedOutflow), new Decimal(0)).toFixed(2),
    [forecast.daily],
  )
  const decisions = useMemo(
    () => data.decisions.slice(0, 3).map((event) => toDecisionItem(event, unit)),
    [data.decisions, unit],
  )
  const largestWindowGap = forecast.windows.reduce<CashflowWindow | null>(
    (largest, item) =>
      !largest || new Decimal(item.maximumGap).greaterThan(largest.maximumGap) ? item : largest,
    null,
  )
  const riskRows = risks.items.map((item) => [
    item.customerName,
    moneyU(item.outstandingAmount, unit),
    item.dueText,
    item.ownerName,
    item.lastFollowupNote || '待跟进',
  ])

  return (
    <>
      <TopBar
        downgraded
        plannedOutflowLabel={moneyU(plannedOutflow, unit)}
        periodLabel={`${forecast.asOfDate} 基准日`}
      />
      <div className="scan" />

      <main className="wrap" style={{ maxWidth: 1480 }}>
        <section className="panel cockpit-title-panel">
          <div className="cockpit-titlebar">
            <div>
              <div className="phead" style={{ marginBottom: 4 }}>
                <div className="t cockpit-title">
                  <b />
                  CEO 经营决策台
                </div>
              </div>
              <div className="cockpit-subtitle">
                日期：{forecast.asOfDate}　数据状态：{forecast.reviewStatus}　规则版本：{forecast.ruleVersion}
              </div>
            </div>
            <div className="cockpit-toolbar">
              <div className="calc-tag">基础数据 → 现金预测 → 风险判断 → 老板拍板</div>
              <button className="retry-btn" onClick={onReload}>
                刷新数据
              </button>
            </div>
          </div>
        </section>

        <section className="panel decision-section">
          <SectionHead title="今日老板要拍板" tag={`${data.decisions.length} 项待处理`} />
          {decisions.length ? (
            <div className="decision-grid">
              {decisions.map((item) => (
                <DecisionCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <EmptyBlock text="当前没有需要老板拍板的事项" />
          )}
        </section>

        <section className="panel decision-section">
          <SectionHead title="30 / 60 / 90 天现金流" tag="每日滚动预测" />
          <div className="cash-window-grid">
            {forecast.windows.map((window) => (
              <CashWindow key={window.days} window={window} unit={unit} />
            ))}
            <div className="cash-window-reason">
              <div className="reason-title">
                最大缺口：{moneyU(largestWindowGap?.maximumGap || '0', unit)}
                {largestWindowGap?.gapDate ? `　出现时间：${formatDate(largestWindowGap.gapDate)}` : ''}
              </div>
              <div className="reason-text">
                期初可用余额 {moneyU(forecast.openingBalance, unit)}；
                逾期且到账日期未确认的应收款 {moneyU(forecast.overdueUnconfirmedAmount, unit)}。
                {forecast.firstBreachDate
                  ? `预计 ${formatDate(forecast.firstBreachDate)} 首次跌破安全线${forecast.recoveryDate ? `，${formatDate(forecast.recoveryDate)} 恢复` : '，预测期内尚未恢复'}。`
                  : '未来 90 天预测余额未跌破安全线。'}
              </div>
              <AIActions />
            </div>
          </div>
        </section>

        <div className="decision-two-col">
          <section className="panel decision-section">
            <SectionHead title="回款风险 Top 3" tag={`${risks.candidateCount} 笔风险`} />
            <RiskTable
              headers={['客户', '未回金额', '到期状态', '负责人', '跟进状态']}
              rows={riskRows}
              link="/repayment"
              emptyText="当前没有临期或逾期回款"
            />
          </section>

          <section className="panel decision-section">
            <SectionHead title="付款建议 Top 3" tag="规则引擎结果" />
            <PaymentList rows={payments.items} unit={unit} />
          </section>
        </div>

        <section className="panel decision-section">
          <SectionHead title="风险责任追踪" tag="MVP 暂由拍板事件承载" />
          <RiskTable
            headers={['风险事项', '责任人', '影响日期', '风险等级', '状态']}
            rows={data.decisions.map((event) => [
              event.title,
              event.ownerName || '待分配',
              formatDate(event.impactDate),
              event.riskLevel === 'red' ? '高风险' : '一般风险',
              event.status === 'pending' ? '待拍板' : event.status,
            ])}
            link="/actions"
            emptyText="当前没有待追踪事项"
          />
        </section>
      </main>
    </>
  )
}

function toDecisionItem(event: DecisionEvent, unit: 'yuan' | 'wan'): DecisionItem {
  const isPayment = event.eventType === 'payment_assessment'
  return {
    id: event.id,
    tone: event.riskLevel === 'yellow' ? 'amber' : event.riskLevel,
    title: event.title,
    impact: moneyU(event.impactAmount, unit),
    reason: reasonText(event.reasonCodes, isPayment ? '付款后现金流预测需要老板确认' : '回款风险达到老板介入条件'),
    owner: event.ownerName || '待分配',
    deadline: event.impactDate ? formatDate(event.impactDate) : '尽快处理',
    suggestion: isPayment ? '确认付款或调整付款日期' : '继续催收或调整预计到账日',
    link: isPayment ? '/approval' : '/repayment',
  }
}

function SectionHead({ title, tag }: { title: string; tag: string }) {
  return (
    <div className="phead">
      <div className="t">
        <b />
        {title}
      </div>
      <div className="calc-tag">{tag}</div>
    </div>
  )
}

const DEMO_MEMBERS = [
  { id: 'u1', name: '张伟', role: '财务总监' },
  { id: 'u2', name: '李娜', role: '运营负责人' },
  { id: 'u3', name: '王芳', role: '销售总监' },
  { id: 'u4', name: '陈强', role: '法务负责人' },
  { id: 'u5', name: '刘洋', role: '风控专员' },
]

function DecisionCard({ item }: { item: DecisionItem }) {
  const tone = TONE[item.tone]
  const [explanation, setExplanation] = useState('')
  const [explaining, setExplaining] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignedTo, setAssignedTo] = useState<{ id: string; name: string; role: string } | null>(null)

  async function explain() {
    setAssignOpen(false)
    setPopoverOpen(true)
    if (explanation) return
    setExplainError(null)
    setExplaining(true)
    try {
      await streamDecisionExplanation(item.id, (event) => {
        if (event.type === 'delta' && typeof event.text === 'string') {
          setExplanation((current) => current + event.text)
        }
      })
    } catch (error) {
      setExplainError(error instanceof ApiError ? error.message : 'AI 解释生成失败')
    } finally {
      setExplaining(false)
    }
  }

  function openAssign() {
    setPopoverOpen(false)
    setAssignOpen(true)
  }

  function handleAssign(member: typeof DEMO_MEMBERS[0]) {
    setAssignedTo(member)
    setAssignOpen(false)
  }

  return (
    <div className="decision-card" style={{ borderColor: tone.border }}>
      <div className="decision-topline">
        <span style={{ color: tone.color }}>今日要拍板</span>
        <span>{item.deadline}</span>
      </div>
      <div className="decision-title">{item.title}</div>
      <div className="decision-facts">
        <div><span>影响</span><strong>{item.impact}</strong></div>
        <div><span>原因</span><strong>{item.reason}</strong></div>
        <div>
          <span>责任人</span>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {assignedTo ? assignedTo.name : item.owner}
            {assignedTo && (
              <span className="assign-badge">已指派</span>
            )}
          </strong>
        </div>
        <div><span>建议</span><strong>{item.suggestion}</strong></div>
      </div>
      <div className="ai-card-actions">
        <Link to={item.link}>查看依据</Link>
        <button type="button" onClick={explain} disabled={explaining}>
          {explaining ? 'AI 正在解释…' : 'AI 解释依据'}
        </button>
        <button type="button" onClick={openAssign} className={assignedTo ? 'assigned' : ''}>
          {assignedTo ? `已指派 · ${assignedTo.name}` : '指派任务'}
        </button>
      </div>

      {/* AI 解释浮层 */}
      {popoverOpen ? (
        <div className="ai-popover" role="dialog" aria-label="AI 解释依据">
          <div className="ai-popover-head">
            <span>AI 解释依据</span>
            <button type="button" onClick={() => setPopoverOpen(false)} aria-label="关闭 AI 解释">
              ×
            </button>
          </div>
          <div className="ai-popover-body">
            {explanation ? (
              <div style={{ whiteSpace: 'pre-wrap' }}>{explanation}</div>
            ) : explaining ? (
              <div>正在生成解释，请稍候…</div>
            ) : null}
            {explainError ? (
              <div style={{ color: 'var(--red)' }}>{explainError}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 指派任务浮层 */}
      {assignOpen ? (
        <div className="assign-popover" role="dialog" aria-label="指派任务">
          <div className="ai-popover-head">
            <span>指派任务给…</span>
            <button type="button" onClick={() => setAssignOpen(false)} aria-label="关闭指派">
              ×
            </button>
          </div>
          <div className="assign-member-list">
            {DEMO_MEMBERS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`assign-member-item${assignedTo?.id === m.id ? ' active' : ''}`}
                onClick={() => handleAssign(m)}
              >
                <span className="assign-avatar">{m.name[0]}</span>
                <span className="assign-info">
                  <span className="assign-name">{m.name}</span>
                  <span className="assign-role">{m.role}</span>
                </span>
                {assignedTo?.id === m.id && <span className="assign-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CashWindow({
  window,
  unit,
}: {
  window: CashflowWindow
  unit: 'yuan' | 'wan'
}) {
  const hasGap = new Decimal(window.maximumGap).greaterThan(0)
  const tone = hasGap ? (window.days === 30 ? 'red' : 'amber') : 'green'
  const color = TONE[tone]
  return (
    <div className="cash-window-card" style={{ borderColor: color.border }}>
      <div className="cash-window-label">{window.days} 天{hasGap ? '最大缺口' : '判断'}</div>
      <div className="cash-window-value" style={{ color: color.color }}>
        {hasGap ? moneyU(window.maximumGap, unit) : '安全'}
      </div>
    </div>
  )
}

function RiskTable({
  headers,
  rows,
  link,
  emptyText,
}: {
  headers: string[]
  rows: string[][]
  link: string
  emptyText: string
}) {
  if (!rows.length) return <EmptyBlock text={emptyText} />
  return (
    <Link to={link} className="decision-table-link">
      <div className="decision-table">
        <div className="decision-table-row head">
          {headers.map((header) => <span key={header}>{header}</span>)}
        </div>
        {rows.map((row, rowIndex) => (
          <div key={`${row[0]}-${rowIndex}`} className="decision-table-row">
            {row.map((cell, cellIndex) => <span key={`${cellIndex}-${cell}`}>{cell}</span>)}
          </div>
        ))}
      </div>
    </Link>
  )
}

function PaymentList({ rows, unit }: { rows: PaymentRecommendation[]; unit: 'yuan' | 'wan' }) {
  if (!rows.length) return <EmptyBlock text="当前没有付款建议" />
  return (
    <div className="payment-list">
      {rows.map((item) => (
        <PaymentCard key={item.id} item={item} unit={unit} />
      ))}
    </div>
  )
}

function PaymentCard({ item, unit }: { item: PaymentRecommendation; unit: 'yuan' | 'wan' }) {
  const [showEvidence, setShowEvidence] = useState(false)
  const [explanation, setExplanation] = useState(item.aiExplanation || '')
  const [explaining, setExplaining] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)

  async function explain() {
    if (explanation) return
    setExplainError(null)
    setExplaining(true)
    try {
      const resp = await paymentRecommendationExplanation(item.id)
      setExplanation(resp.aiExplanation)
    } catch (error) {
      setExplainError(error instanceof ApiError ? error.message : 'AI 解释生成失败')
    } finally {
      setExplaining(false)
    }
  }

  const fallbackReason = `${item.rigidity === 'rigid' ? '刚性' : '非刚性'}支出，计划 ${formatDate(item.plannedDate)} 支付`
  return (
    <div className="payment-item">
      <div className="payment-item-head">
        <span>{item.expenseName}</span>
        <strong>{moneyU(item.plannedAmount, unit)}</strong>
      </div>
      <div className="payment-advice">{PAYMENT_LABEL[item.decision]}</div>
      <div className="payment-reason">
        {reasonText(item.reasonCodes, fallbackReason)}
      </div>
      <div className="ai-card-actions compact">
        <button type="button" onClick={() => setShowEvidence((current) => !current)}>
          {showEvidence ? '收起依据' : '查看依据'}
        </button>
        <button type="button" onClick={explain} disabled={explaining}>
          {explanation ? '已生成 AI 依据' : explaining ? 'AI 正在解释…' : 'AI 解释依据'}
        </button>
      </div>
      {showEvidence ? <PaymentEvidence item={item} unit={unit} /> : null}
      {explanation ? (
        <div className="reason-text" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
          {explanation}
        </div>
      ) : null}
      {explainError ? (
        <div className="reason-text" style={{ marginTop: 10, color: 'var(--red)' }}>
          {explainError}
        </div>
      ) : null}
    </div>
  )
}

function PaymentEvidence({ item, unit }: { item: PaymentRecommendation; unit: 'yuan' | 'wan' }) {
  const rows = [
    ['支出编号', item.expenseNo],
    ['计划日期', formatDate(item.plannedDate)],
    ['审批状态', item.approvalStatus],
    ['刚性程度', item.rigidity === 'rigid' ? '刚性' : '可延期'],
    ['支付前最大缺口', item.gapBefore ? moneyU(item.gapBefore, unit) : '无试算'],
    ['支付后最大缺口', item.gapAfter ? moneyU(item.gapAfter, unit) : '无试算'],
    ['缺口增加', item.gapIncrease ? moneyU(item.gapIncrease, unit) : '无试算'],
    ['缺口日期', item.gapDate ? formatDate(item.gapDate) : '无'],
    ['恢复日期', item.recoveryDate ? formatDate(item.recoveryDate) : '无'],
    ['规则依据', reasonText(item.reasonCodes, '未命中额外原因')],
  ]
  return (
    <div className="reason-text" style={{ marginTop: 10 }}>
      {rows.map(([label, value]) => (
        <div key={label}>
          {label}：{value}
        </div>
      ))}
    </div>
  )
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="reason-text" style={{ padding: '28px 8px', textAlign: 'center' }}>{text}</div>
}

function AIActions({ compact = false, link }: { compact?: boolean; link?: string }) {
  return (
    <div className={compact ? 'ai-card-actions compact' : 'ai-card-actions'}>
      {link ? <Link to={link}>查看依据</Link> : null}
      {!compact ? <button type="button" disabled title="AI 解释仅在老板拍板事件中开放">AI 解释依据</button> : null}
    </div>
  )
}
