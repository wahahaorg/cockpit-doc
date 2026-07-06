// 回款风险卡（Layer 2 · 回款风险引擎）—— 回答老板「哪笔回款该回没回、逾期几天、谁负责、最近是否跟进、今天要谁处理」。
// 顶部今日作战条（今日待处理 / 逾期 / 红黄绿计数）+ 应收风险列表（后端已排序，直接渲染）+ 每条「记今日跟进」。
// 只读基调：界面不出现任何催款/打款等资金写操作，唯一写动作是「记跟进」（不碰金额/状态）。金额字符串不 parseFloat，用 moneyU 跟随单位。
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { repaymentRisks, repaymentFollowup, ApiError } from '../api'
import type {
  RepaymentRisksResp,
  RepaymentRiskItem,
  RepaymentRiskLight,
} from '../api/types'
import { TopBar } from '../components/TopBar'
import { Loading, ErrorState, Empty } from '../components/StateBox'
import { moneyU } from '../lib/format'
import { useUnit } from '../store/unit'

const DASH_MONTH = '2026-06'

// 风险灯三值（无 na）。
const LIGHT: Record<RepaymentRiskLight, { tone: string; label: string }> = {
  red: { tone: 'var(--red)', label: '高风险' },
  amber: { tone: 'var(--amber)', label: '关注' },
  green: { tone: 'var(--green)', label: '正常' },
}

const FOLLOWUP_PLACEHOLDER = '老板已介入 · 今日跟进'

export function Repayment() {
  const [data, setData] = useState<RepaymentRisksResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const resp = await repaymentRisks() // 缺省 asOf=当天
      setData(resp)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '加载失败')
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
        <TopBar periodLabel="2026 · 06月账期" />
        <div className="wrap">
          <div className="panel">
            <Loading msg="正在扫描应收回款风险…" />
          </div>
        </div>
      </>
    )
  }
  if (err || !data) {
    return (
      <>
        <TopBar periodLabel="2026 · 06月账期" />
        <div className="wrap">
          <div className="panel">
            <ErrorState
              msg={err || '加载失败'}
              sub="请确认后端已启动 (127.0.0.1:8000) 后重试"
              onRetry={load}
            />
          </div>
        </div>
      </>
    )
  }

  return <RepaymentView data={data} onReload={load} />
}

function RepaymentView({
  data,
  onReload,
}: {
  data: RepaymentRisksResp
  onReload: () => Promise<void>
}) {
  const unit = useUnit()

  // 本机维护各笔的最新状态（记跟进后局部更新，不必整页重拉）。
  const [items, setItems] = useState<RepaymentRiskItem[]>(data.items)
  useEffect(() => {
    setItems(data.items)
  }, [data])

  // 今日待处理实时跟随列表（记跟进后该笔 todayAction 翻 false，头条计数同步下降）；
  // 其余汇总（金额/灯计数）依赖 followup 不变的字段，沿用加载时快照。
  const liveTodayCount = items.filter((it) => it.todayAction).length
  const summary = { ...data.summary, todayCount: liveTodayCount }

  return (
    <>
      <TopBar periodLabel={`${DASH_MONTH.split('-')[0]} · ${DASH_MONTH.split('-')[1]}月账期`} />
      <div className="scan" />

      <div className="wrap">
        {/* 概览条 */}
        <div className="panel" style={{ animationDelay: '.04s' }}>
          <div className="phead" style={{ marginBottom: 6 }}>
            <div className="t">
              <b />
              回款风险卡 · Repayment Risk
            </div>
            <span className="calc-tag">确定性规则 · 可复算</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--dimmer)' }}>
            对每笔应收算逾期天数 · 风险灯 · 是否今日待处理，按风险与逾期降序。只读风险态势 · 仅记跟进，不发起任何资金动作。
          </div>
        </div>

        {/* 今日作战条 */}
        <TodayBar summary={summary} unit={unit} asOf={data.asOf} />

        {/* 应收风险列表 */}
        <div className="panel" style={{ marginTop: 16, animationDelay: '.12s' }}>
          <div className="phead">
            <div className="t">
              <b />
              应收风险列表 · {items.length} 笔
            </div>
            {data.isPlaceholder && (
              <span className="calc-tag amber">demo 数据 · 待接入真实应收数据源</span>
            )}
          </div>

          {items.length === 0 ? (
            <Empty msg="暂无应收记录" sub="待接入真实应收数据源" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map((it) => (
                <RiskRow key={it.id} item={it} unit={unit} onUpdated={onReload} />
              ))}
            </div>
          )}
        </div>

        {/* 底部声明 */}
        <div className="footnote" style={{ marginTop: 16 }}>
          <span style={{ color: 'var(--cyan)', fontFamily: 'var(--disp)', letterSpacing: 1 }}>
            只读 · 仅记跟进 · 不发起任何资金动作
          </span>
          <span>
            <i style={{ background: 'var(--red)' }} />
            高风险 · 逾期重 / 大额
          </span>
          <span>
            <i style={{ background: 'var(--amber)' }} />
            关注 · 临期 / 逾期轻
          </span>
          <span>
            <i style={{ background: 'var(--green)' }} />
            正常 · 已回 / 未到期
          </span>
          <span style={{ color: 'var(--dimmer)' }}>
            风险灯确定性推导 · 客户名已脱敏入审计 · 完整态势见{' '}
            <Link to="/" style={{ color: 'var(--cyan)' }}>
              驾驶舱
            </Link>
            {data.isPlaceholder && ' · demo 数据待接入真实应收源'}
          </span>
          <button
            onClick={onReload}
            style={{
              fontFamily: 'var(--disp)',
              fontSize: 11,
              letterSpacing: 1,
              color: 'var(--dim)',
              border: '1px solid var(--hairline-2)',
              background: 'transparent',
              borderRadius: 7,
              padding: '5px 12px',
              cursor: 'pointer',
            }}
          >
            刷新
          </button>
        </div>
      </div>
    </>
  )
}

// ---- 顶部今日作战条 ----
function TodayBar({
  summary,
  unit,
  asOf,
}: {
  summary: RepaymentRisksResp['summary']
  unit: 'yuan' | 'wan'
  asOf: string
}) {
  return (
    <div className="panel" style={{ marginTop: 16, animationDelay: '.08s' }}>
      <div className="phead" style={{ marginBottom: 14 }}>
        <div className="t">
          <b />
          今日作战 · {asOf}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <CountPill tone="var(--red)" n={summary.redCount} label="红" />
          <CountPill tone="var(--amber)" n={summary.amberCount} label="黄" />
          <CountPill tone="var(--green)" n={summary.greenCount} label="绿" />
        </div>
      </div>

      <div className="gap-wrap" style={{ flexWrap: 'wrap', gap: 24 }}>
        {/* 今日待处理大字 */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            今日待处理
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <span
              className="num"
              style={{
                fontSize: 64,
                fontWeight: 800,
                lineHeight: 0.95,
                color: summary.todayCount > 0 ? 'var(--red)' : 'var(--green)',
                textShadow:
                  summary.todayCount > 0 ? '0 0 28px rgba(216,58,87,0.35)' : 'none',
              }}
            >
              {summary.todayCount}
            </span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--dim)', paddingBottom: 8 }}>
              笔
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--dimmer)', marginTop: 4 }}>
            今天要谁处理 · 已按风险置顶
          </div>
        </div>

        {/* 指标块 */}
        <div className="gap-eq" style={{ marginTop: 0, alignSelf: 'center' }}>
          <Metric
            label="逾期笔数"
            value={`${summary.overdueCount} 笔`}
            tone={summary.overdueCount > 0 ? 'var(--red)' : 'var(--text)'}
          />
          <span className="op">·</span>
          <Metric
            label="逾期金额"
            value={moneyU(summary.overdueAmount, unit)}
            tone={summary.overdueCount > 0 ? 'var(--red)' : 'var(--text)'}
          />
          <span className="op">·</span>
          <Metric label="风险敞口" value={moneyU(summary.atRiskAmount, unit)} tone="var(--gold)" />
          <span className="op">·</span>
          <Metric
            label="未回 / 已回"
            value={`${summary.pendingCount} / ${summary.receivedCount}`}
          />
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="item">
      <div className="l">{label}</div>
      <div className="v num" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  )
}

function CountPill({ tone, n, label }: { tone: string; n: number; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontFamily: 'var(--mono)',
        fontSize: 13,
        color: tone,
        border: `1px solid ${tone}`,
        borderRadius: 999,
        padding: '3px 12px',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: tone,
          boxShadow: `0 0 8px ${tone}`,
        }}
      />
      {n} {label}
    </span>
  )
}

// ---- 单条应收风险行 ----
function RiskRow({
  item,
  unit,
  onUpdated,
}: {
  item: RepaymentRiskItem
  unit: 'yuan' | 'wan'
  onUpdated: () => Promise<void>
}) {
  const lt = LIGHT[item.riskLight]
  const isReceived = item.status === 'received'

  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [rowErr, setRowErr] = useState<string | null>(null)

  async function submit() {
    const text = (note.trim() || FOLLOWUP_PLACEHOLDER).trim()
    setSaving(true)
    setRowErr(null)
    try {
      await repaymentFollowup(item.id, text)
      await onUpdated()
      setOpen(false)
      setNote('')
    } catch (e) {
      setRowErr(e instanceof ApiError ? e.message : '记录失败')
    } finally {
      setSaving(false)
    }
  }

  // todayAction 行：左边框高亮 + 底色强调（置顶已由后端排序保证）。
  const highlight = item.todayAction

  return (
    <div
      style={{
        position: 'relative',
        border: '1px solid var(--hairline)',
        borderLeft: `3px solid ${lt.tone}`,
        borderRadius: 8,
        padding: '14px 16px',
        background: highlight
          ? `color-mix(in srgb, ${lt.tone} 6%, var(--panel-2))`
          : 'var(--panel-2)',
      }}
    >
      {/* 第一行：灯 + 客户 + 摘要 + 今日徽标 + 风险灯标 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: lt.tone,
              boxShadow: `0 0 9px ${lt.tone}`,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
            {item.customer}
          </span>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>{item.summary}</span>
          {item.todayAction && (
            <span
              style={{
                fontFamily: 'var(--disp)',
                fontSize: 10,
                letterSpacing: 1,
                color: 'var(--red)',
                border: '1px solid var(--red)',
                background: 'color-mix(in srgb, var(--red) 10%, transparent)',
                borderRadius: 999,
                padding: '2px 9px',
                whiteSpace: 'nowrap',
              }}
            >
              ◆ 今日处理
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {isReceived && (
            <span
              style={{
                fontFamily: 'var(--disp)',
                fontSize: 10,
                letterSpacing: 1,
                color: 'var(--green)',
                border: '1px solid rgba(15,158,107,0.4)',
                background: 'rgba(15,158,107,0.1)',
                borderRadius: 999,
                padding: '2px 9px',
              }}
            >
              ✓ 已回款
            </span>
          )}
          <span
            style={{
              fontFamily: 'var(--disp)',
              fontSize: 10,
              letterSpacing: 1,
              color: lt.tone,
              border: `1px solid ${lt.tone}`,
              borderRadius: 999,
              padding: '2px 10px',
              whiteSpace: 'nowrap',
            }}
          >
            {lt.label}
          </span>
        </div>
      </div>

      {/* 第二行：金额 / 到期 / 逾期 / 负责人 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          flexWrap: 'wrap',
          marginTop: 12,
        }}
      >
        <Field label="预期金额">
          <span className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--gold)' }}>
            {moneyU(item.expectedAmount, unit, 2)}
          </span>
        </Field>
        <Field label="到期日">
          <span className="num" style={{ fontSize: 14, color: 'var(--text)' }}>
            {item.dueDate}
          </span>
        </Field>
        <Field label="逾期">
          <OverdueText item={item} />
        </Field>
        <Field label="负责人">
          <span className="pill cyan">{item.owner}</span>
        </Field>
      </div>

      {/* 第三行：最近跟进 + 记今日跟进动作 */}
      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--hairline)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 200, fontSize: 12, lineHeight: 1.6 }}>
          <span
            style={{
              color: 'var(--dimmer)',
              fontFamily: 'var(--disp)',
              letterSpacing: 1,
              marginRight: 8,
            }}
          >
            最近跟进
          </span>
          {item.lastFollowupDate ? (
            <>
              <span className="num" style={{ color: 'var(--cyan)' }}>
                {item.lastFollowupDate}
              </span>
              {item.lastFollowupNote && (
                <span style={{ color: 'var(--dim)' }}> · {item.lastFollowupNote}</span>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--dimmer)' }}>暂无跟进</span>
          )}
        </div>

        {/* received 行不显示跟进动作 */}
        {!isReceived &&
          (open ? null : (
            <button
              onClick={() => {
                setOpen(true)
                setRowErr(null)
              }}
              style={{
                fontFamily: 'var(--disp)',
                fontSize: 12,
                letterSpacing: 0.5,
                color: item.todayAction ? lt.tone : 'var(--cyan)',
                border: `1px solid ${item.todayAction ? lt.tone : 'rgba(14,143,160,0.4)'}`,
                background: 'transparent',
                borderRadius: 6,
                padding: '6px 14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              记今日跟进
            </button>
          ))}
      </div>

      {/* 跟进输入框（展开） */}
      {!isReceived && open && (
        <div style={{ marginTop: 12 }}>
          <label className="field-lab">跟进备注</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={FOLLOWUP_PLACEHOLDER}
            autoFocus
            style={{
              width: '100%',
              background: 'var(--panel)',
              border: '1px solid var(--hairline-2)',
              borderRadius: 8,
              padding: '10px 12px',
              color: 'var(--text)',
              fontFamily: 'var(--cn)',
              fontSize: 14,
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          {rowErr && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>{rowErr}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <button
              onClick={() => {
                setOpen(false)
                setNote('')
                setRowErr(null)
              }}
              disabled={saving}
              style={{
                fontFamily: 'var(--disp)',
                fontSize: 13,
                color: 'var(--dim)',
                border: '1px solid var(--hairline-2)',
                background: 'transparent',
                borderRadius: 8,
                padding: '8px 18px',
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              取消
            </button>
            <button
              onClick={() => void submit()}
              disabled={saving}
              style={{
                fontFamily: 'var(--disp)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--panel)',
                border: '1px solid var(--cyan)',
                background: 'var(--cyan)',
                borderRadius: 8,
                padding: '8px 18px',
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? '记录中…' : '记跟进'}
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--dimmer)' }}>
            仅记录跟进备注 · 不改任何金额 / 状态 · 不发起催款 / 打款
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: 1,
          color: 'var(--dimmer)',
          fontFamily: 'var(--disp)',
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}

// 逾期天数：逾期红/黄字；未到期显示距到期天数；已回显示「—」。
function OverdueText({ item }: { item: RepaymentRiskItem }) {
  if (item.status === 'received') {
    return <span style={{ fontSize: 14, color: 'var(--dimmer)' }}>—</span>
  }
  if (item.overdueDays > 0) {
    const tone = item.riskLight === 'red' ? 'var(--red)' : 'var(--amber)'
    return (
      <span className="num" style={{ fontSize: 15, fontWeight: 700, color: tone }}>
        逾期 {item.overdueDays} 天
      </span>
    )
  }
  if (item.daysToDue === 0) {
    return (
      <span className="num" style={{ fontSize: 14, fontWeight: 600, color: 'var(--amber)' }}>
        今日到期
      </span>
    )
  }
  return (
    <span className="num" style={{ fontSize: 14, color: 'var(--dim)' }}>
      距到期 {item.daysToDue} 天
    </span>
  )
}
