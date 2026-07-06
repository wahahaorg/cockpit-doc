// 风险派发作战室（Layer 2 demo · 老李视角：哪有风险 · 多大 · 建议怎么办 · 归谁解决）。
// 全部基于已有驾驶舱数据用确定性规则推导，只读预警 —— 不接真实工单、不发起任何资金/派发写操作。
// 注：风险规则目前在前端推导（demo）；上线版应下沉到后端确定性引擎以便审计复算。
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Decimal from 'decimal.js'
import {
  cashGap,
  forecast,
  gaThreshold,
  listConfig,
  health,
  listClassification,
  ApiError,
} from '../api'
import type {
  CashGapResp,
  ForecastResp,
  GAThresholdResp,
  ConfigParam,
  ClassificationItem,
} from '../api/types'
import { TopBar } from '../components/TopBar'
import { Loading, ErrorState } from '../components/StateBox'
import { moneyU, toWan, usageRate, lightFromUsage } from '../lib/format'
import { useUnit } from '../store/unit'

const DASH_MONTH = '2026-06'
const FC_FROM = '2026-01'
const FC_TO = '2026-12'

type Level = 'red' | 'amber' | 'green'
const LEVEL_COLOR: Record<Level, string> = {
  red: 'var(--red)',
  amber: 'var(--amber)',
  green: 'var(--green)',
}
const LEVEL_LABEL: Record<Level, string> = { red: '高', amber: '关注', green: '正常' }
const LEVEL_ORDER: Record<Level, number> = { red: 0, amber: 1, green: 2 }

interface Risk {
  id: string
  level: Level
  dimension: string
  metric: string
  status: string
  suggestion: string | null
  owner: string
}

interface DispData {
  gap: CashGapResp
  fc: ForecastResp
  ga: GAThresholdResp
  config: ConfigParam[]
  llmEnabled: boolean
  reviewItems: ClassificationItem[]
}

function buildRisks(d: DispData, unit: 'yuan' | 'wan'): Risk[] {
  const risks: Risk[] = []
  const { gap, fc, ga } = d
  const m = (v: string, dec = 0) => moneyU(v, unit, dec)

  // 1) 现金流缺口
  {
    const gapWan = toWan(gap.gap)
    const availWan = toWan(gap.availableCash)
    const level: Level = !gap.isShortfall ? 'green' : gapWan > availWan ? 'red' : 'amber'
    risks.push({
      id: 'cash-gap',
      level,
      dimension: '现金流缺口',
      metric: m(gap.gap),
      status: gap.isShortfall
        ? `本月计划支出 ${m(gap.plannedOutflow)} − 可用现金 ${m(gap.availableCash)},缺口需对外筹措`
        : `现金充裕,本月盈余 ${m(gap.gap.replace('-', ''))}`,
      suggestion: gap.isShortfall
        ? `优先筹措 ${m(gap.gap)};或下调本月投放节奏以收窄缺口`
        : null,
      owner: '财务负责人 / 老板',
    })
  }

  // 2) 现金低谷与转正
  {
    const pts = fc.points.map((p) => ({ month: p.month, cum: toWan(p.cumulativeCash) }))
    const low = pts.reduce((m, c) => (c.cum < m.cum ? c : m), pts[0])
    const turn = fc.turnPositiveMonth
    const level: Level = low.cum >= 0 ? 'green' : turn ? 'amber' : 'red'
    risks.push({
      id: 'cash-trough',
      level,
      dimension: '现金低谷与转正',
      metric: m(String(Math.round(low.cum * 10000))),
      status:
        low.cum >= 0
          ? '账期窗口内现金位置始终为正'
          : `现金位置最低 ${m(String(Math.round(low.cum * 10000)))}(${low.month})${
              turn ? `,预计 ${turn} 转正` : ',账期窗口内未转正'
            }`,
      suggestion:
        low.cum >= 0
          ? null
          : turn
            ? `低谷期(至 ${turn})备足过桥资金,避免现金断流`
            : `账期内不转正,需重审投放规模或拉长账期假设`,
      owner: '财务负责人 / 老板',
    })
  }

  // 3) 管理费用阈值
  {
    const usage = usageRate(ga.used, ga.monthlyThreshold)
    const light = lightFromUsage(ga.used, ga.monthlyThreshold, ga.greenBand, ga.yellowBand)
    risks.push({
      id: 'ga-threshold',
      level: light,
      dimension: '管理费用阈值',
      metric: `${usage}%`,
      status:
        light === 'green'
          ? `本月已用 ${m(ga.used, 2)} / 阈值 ${m(ga.monthlyThreshold, 2)},绿区,小额可批`
          : light === 'amber'
            ? `本月已用 ${m(ga.used, 2)},接近阈值 ${m(ga.monthlyThreshold, 2)}`
            : `本月已用 ${m(ga.used, 2)},已超阈值 ${m(ga.monthlyThreshold, 2)}`,
      suggestion:
        light === 'green'
          ? null
          : light === 'amber'
            ? '收紧非必要管理费用支出,大额审批前先看本面板'
            : '立即冻结非必要管理费用支出并复盘超支项',
      owner: '行政 / 各部门负责人',
    })
  }

  // 4) 回款节奏（掉链子检测）
  {
    const inflows = fc.points.map((p) => ({ month: p.month, v: toWan(p.inflowThisMonth) }))
    const nonzero = inflows.filter((x) => x.v > 0)
    const avg = nonzero.length ? nonzero.reduce((a, b) => a + b.v, 0) / nonzero.length : 0
    const dips = nonzero.filter((x) => x.v < avg * 0.6)
    const level: Level = dips.length ? 'amber' : 'green'
    risks.push({
      id: 'repay-rhythm',
      level,
      dimension: '回款节奏',
      metric: m(String(Math.round(avg * 10000))) + ' / 月',
      status: dips.length
        ? `${dips.map((x) => x.month).join('、')} 回款低于月均 40%+,疑似掉链子`
        : `月均回款 ${m(String(Math.round(avg * 10000)))},节奏稳定无掉链子`,
      suggestion: dips.length ? `核查 / 催收 ${dips.map((x) => x.month).join('、')} 回款来源` : null,
      owner: '销售 / 渠道负责人',
    })
  }

  // 5) 流水复核积压
  {
    const count = d.reviewItems.length
    const sum = d.reviewItems.reduce((acc, it) => acc.plus(new Decimal(it.amount || 0)), new Decimal(0))
    const level: Level = count === 0 ? 'green' : sum.gte(new Decimal('30000000')) ? 'red' : 'amber'
    risks.push({
      id: 'review-backlog',
      level,
      dimension: '流水复核积压',
      metric: `${count} 笔 / ${m(sum.toFixed(0))}`,
      status: count
        ? `${count} 笔大额流水待人工确认,轴向未定会影响收/支现金口径`
        : '全部已分类,无积压',
      suggestion: count ? '尽快复核高额未定项,确认收 / 支轴向' : null,
      owner: '财务复核岗',
    })
  }

  return risks.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
}

export function Dispatch() {
  const [data, setData] = useState<DispData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const [gap, fc, ga, config, hp] = await Promise.all([
        cashGap(DASH_MONTH),
        forecast(FC_FROM, FC_TO),
        gaThreshold(DASH_MONTH),
        listConfig(),
        health(),
      ])
      let reviewItems: ClassificationItem[] = []
      try {
        const list = await listClassification({ batchId: 1, needReview: true, pageSize: 200 })
        reviewItems = list.items
      } catch {
        /* 积压汇总失败不阻塞 */
      }
      setData({ gap, fc, ga, config, llmEnabled: hp.llmEnabled, reviewItems })
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
            <Loading msg="正在扫描经营风险态势…" />
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

  return <DispatchView data={data} />
}

function DispatchView({ data }: { data: DispData }) {
  const downgraded = !data.llmEnabled
  const accountMonths = data.config.find((c) => c.key === 'account_period_months')?.value
  const unit = useUnit()
  const risks = useMemo(() => buildRisks(data, unit), [data, unit])
  const counts = risks.reduce(
    (acc, r) => ((acc[r.level] += 1), acc),
    { red: 0, amber: 0, green: 0 } as Record<Level, number>
  )
  const [dispatched, setDispatched] = useState<Set<string>>(new Set())
  // 老板可改：建议动作 + 责任人覆盖（本机持久化，演示态）
  const [overrides, setOverrides] = useState<Record<string, { suggestion: string; owner: string }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('cockpit:dispatch-overrides') || '{}')
    } catch {
      return {}
    }
  })
  const [editing, setEditing] = useState<
    { id: string; dimension: string; suggestion: string; owner: string } | null
  >(null)

  function saveOverride(id: string, suggestion: string, owner: string) {
    setOverrides((prev) => {
      const next = { ...prev, [id]: { suggestion, owner } }
      try {
        localStorage.setItem('cockpit:dispatch-overrides', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
    setEditing(null)
  }

  return (
    <>
      <TopBar
        downgraded={downgraded}
        accountPeriodMonths={accountMonths ? Number(accountMonths) : data.fc.accountPeriodMonths}
        plannedOutflowLabel={moneyU(data.gap.plannedOutflow, unit)}
        periodLabel={`${data.gap.month.split('-')[0]} · ${data.gap.month.split('-')[1]}月账期`}
      />
      <div className="scan" />

      <div className="wrap">
        {/* 概览条 */}
        <div className="panel" style={{ animationDelay: '.04s' }}>
          <div className="phead" style={{ marginBottom: 6 }}>
            <div className="t">
              <b />
              风险派发作战室 · Risk &amp; Dispatch
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Pill color="var(--red)" text={`${counts.red} 高`} />
              <Pill color="var(--amber)" text={`${counts.amber} 关注`} />
              <Pill color="var(--green)" text={`${counts.green} 正常`} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--dimmer)' }}>
            扫描每条经营战线 → 风险等级 · 关键数字 · 建议动作 · 指派责任人。只读预警 · 演示派发,不接真实工单、不发起任何资金操作。
          </div>
        </div>

        {/* 风险卡片网格 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          {risks.map((r, i) => {
            const col = LEVEL_COLOR[r.level]
            const done = dispatched.has(r.id)
            const ov = overrides[r.id]
            const effSuggestion = ov ? ov.suggestion : r.suggestion
            const effOwner = ov ? ov.owner : r.owner
            const edited = !!ov
            return (
              <div
                key={r.id}
                className="panel"
                style={{ animationDelay: `${0.06 + i * 0.05}s`, borderLeft: `3px solid ${col}` }}
              >
                <div className="phead">
                  <div className="t">
                    <b style={{ background: col, boxShadow: `0 0 8px ${col}` }} />
                    {r.dimension}
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        letterSpacing: 1,
                        color: col,
                        border: `1px solid ${col}`,
                        borderRadius: 999,
                        padding: '1px 8px',
                        fontFamily: 'var(--disp)',
                      }}
                    >
                      {LEVEL_LABEL[r.level]}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--cyan)',
                      border: '1px solid rgba(54,224,224,.3)',
                      background: 'var(--cyan-soft)',
                      borderRadius: 999,
                      padding: '3px 10px',
                      fontFamily: 'var(--disp)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {effOwner}
                  </span>
                </div>

                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontWeight: 700,
                    fontSize: 30,
                    color: col,
                    letterSpacing: '-0.5px',
                    margin: '4px 0 8px',
                  }}
                >
                  {r.metric}
                </div>
                <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.6, minHeight: 40 }}>
                  {r.status}
                </div>

                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: '1px solid var(--hairline)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div style={{ fontSize: 12, color: effSuggestion ? 'var(--text)' : 'var(--dimmer)', flex: 1, lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--dimmer)', fontFamily: 'var(--disp)', letterSpacing: 1, marginRight: 6 }}>
                      建议
                    </span>
                    {effSuggestion || '正常 · 无需动作'}
                    {edited && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 10,
                          color: 'var(--cyan)',
                          border: '1px solid rgba(54,224,224,.3)',
                          borderRadius: 4,
                          padding: '1px 6px',
                          fontFamily: 'var(--disp)',
                        }}
                      >
                        已调整
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    <button
                      onClick={() =>
                        setEditing({
                          id: r.id,
                          dimension: r.dimension,
                          suggestion: effSuggestion || '',
                          owner: effOwner,
                        })
                      }
                      style={{
                        fontFamily: 'var(--disp)',
                        fontSize: 12,
                        letterSpacing: 0.5,
                        color: 'var(--dim)',
                        border: '1px solid var(--hairline-2)',
                        background: 'transparent',
                        borderRadius: 6,
                        padding: '6px 12px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      编辑
                    </button>
                    {effSuggestion &&
                      (done ? (
                        <span style={{ fontSize: 12, color: 'var(--green)', fontFamily: 'var(--disp)', whiteSpace: 'nowrap' }}>
                          ✓ 已派发
                        </span>
                      ) : (
                        <button
                          onClick={() => setDispatched((s) => new Set(s).add(r.id))}
                          style={{
                            fontFamily: 'var(--disp)',
                            fontSize: 12,
                            letterSpacing: 0.5,
                            color: col,
                            border: `1px solid ${col}`,
                            background: 'transparent',
                            borderRadius: 6,
                            padding: '6px 14px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          派发 →
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {editing && (
          <div
            onClick={() => setEditing(null)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 100,
              background: 'rgba(3,6,12,0.72)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
            }}
          >
            <div
              className="panel"
              onClick={(e) => e.stopPropagation()}
              style={{ width: 'min(560px, 92vw)', animation: 'none', opacity: 1, transform: 'none' }}
            >
              <div className="phead">
                <div className="t">
                  <b />
                  编辑建议 · {editing.dimension}
                </div>
                <span style={{ fontSize: 11, color: 'var(--dimmer)', fontFamily: 'var(--disp)', letterSpacing: 1 }}>
                  老板可改
                </span>
              </div>

              <label style={{ display: 'block', fontSize: 11, color: 'var(--dimmer)', fontFamily: 'var(--disp)', letterSpacing: 1, margin: '6px 0 6px' }}>
                建议动作
              </label>
              <textarea
                value={editing.suggestion}
                onChange={(e) => setEditing({ ...editing, suggestion: e.target.value })}
                rows={3}
                placeholder="输入要下达的动作（留空 = 无需动作）"
                style={{
                  width: '100%',
                  background: 'var(--panel-2)',
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

              <label style={{ display: 'block', fontSize: 11, color: 'var(--dimmer)', fontFamily: 'var(--disp)', letterSpacing: 1, margin: '14px 0 6px' }}>
                指派责任人
              </label>
              <input
                value={editing.owner}
                onChange={(e) => setEditing({ ...editing, owner: e.target.value })}
                placeholder="如 财务负责人 / 老李"
                style={{
                  width: '100%',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--hairline-2)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: 'var(--text)',
                  fontFamily: 'var(--cn)',
                  fontSize: 14,
                  boxSizing: 'border-box',
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                <button
                  onClick={() => setEditing(null)}
                  style={{
                    fontFamily: 'var(--disp)',
                    fontSize: 13,
                    color: 'var(--dim)',
                    border: '1px solid var(--hairline-2)',
                    background: 'transparent',
                    borderRadius: 8,
                    padding: '8px 18px',
                    cursor: 'pointer',
                  }}
                >
                  取消
                </button>
                <button
                  onClick={() => saveOverride(editing.id, editing.suggestion.trim(), editing.owner.trim())}
                  style={{
                    fontFamily: 'var(--disp)',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#06080F',
                    border: '1px solid var(--cyan)',
                    background: 'var(--cyan)',
                    borderRadius: 8,
                    padding: '8px 18px',
                    cursor: 'pointer',
                  }}
                >
                  保存
                </button>
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: 'var(--dimmer)' }}>
                改动仅本机保存(演示) · 不接真实工单、不发起任何资金操作
              </div>
            </div>
          </div>
        )}

        <div className="footnote" style={{ marginTop: 16 }}>
          <span>
            <i style={{ background: 'var(--red)' }} />高 · 需立即处置
          </span>
          <span>
            <i style={{ background: 'var(--amber)' }} />关注 · 建议跟进
          </span>
          <span>
            <i style={{ background: 'var(--green)' }} />正常 · 无需动作
          </span>
          <span style={{ color: 'var(--dimmer)' }}>
            风险规则确定性推导 · 占位数字标「待财务复核」 · 完整数字见{' '}
            <Link to="/" style={{ color: 'var(--cyan)' }}>
              驾驶舱
            </Link>
          </span>
        </div>
      </div>
    </>
  )
}

function Pill({ color, text }: { color: string; text: string }) {
  return (
    <span
      style={{
        fontFamily: 'var(--mono)',
        fontSize: 13,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: '2px 12px',
      }}
    >
      {text}
    </span>
  )
}
