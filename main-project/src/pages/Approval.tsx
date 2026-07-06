// 支出审批判断卡（Layer 2 · 确定性规则引擎）—— 回答老板「这笔钱该不该付」。
// 左侧录入拟付款 → 调 POST /api/approval/check → 右侧展示证据链：
// 总灯 + 命中规则逐条（灯/说明/证据来源）+ 剩余额度 + 建议责任人 + 例外。
// 只读判断：界面不出现任何「确认付款 / 打款」真实资金写操作；金额/收款方走 body 不走 URL。
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { approvalCheck, ApiError } from '../api'
import type {
  ApprovalCheckResp,
  ApprovalLight,
  BudgetCategory,
} from '../api/types'
import { TopBar } from '../components/TopBar'
import { Loading, ErrorState } from '../components/StateBox'
import { moneyU } from '../lib/format'
import { useUnit } from '../store/unit'

const DASH_MONTH = '2026-06'

const CATEGORY_OPTIONS: { value: BudgetCategory; label: string }[] = [
  { value: 'ga', label: '管理费用' },
  { value: 'marketing', label: '市场投入' },
  { value: 'claim', label: '赔付' },
  { value: 'procurement', label: '采购' },
  { value: 'other', label: '其它' },
]

// 总灯（三值）文案。
const TOTAL_LIGHT: Record<'green' | 'amber' | 'red', { label: string; tone: string }> = {
  green: { label: '可批', tone: 'var(--green)' },
  amber: { label: '需复核', tone: 'var(--amber)' },
  red: { label: '不建议批', tone: 'var(--red)' },
}

// 规则四值灯（含 na = 不适用，灰显）。
const RULE_LIGHT: Record<ApprovalLight, { dot: string; label: string; tone: string }> = {
  green: { dot: 'var(--green)', label: '通过', tone: 'var(--green)' },
  amber: { dot: 'var(--amber)', label: '关注', tone: 'var(--amber)' },
  red: { dot: 'var(--red)', label: '不予放行', tone: 'var(--red)' },
  na: { dot: 'var(--dimmer)', label: '不适用', tone: 'var(--dimmer)' },
}

interface FormState {
  amount: string
  budgetCategory: BudgetCategory
  payee: string
  hasSettlementDoc: boolean
  purpose: string
}

// 预置：一进来就触发红灯的采购示例（无结算单），让老板立刻看到证据链效果。
const DEFAULT_FORM: FormState = {
  amount: '600000',
  budgetCategory: 'procurement',
  payee: '某供应商',
  hasSettlementDoc: false,
  purpose: '服务器采购',
}

export function Approval() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [result, setResult] = useState<ApprovalCheckResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const unit = useUnit()

  // 用 ref 持有最新表单，避免防抖闭包读到旧值；用请求序号防竞态（旧响应不覆盖新结果）。
  const formRef = useRef(form)
  formRef.current = form
  const seqRef = useRef(0)

  async function runCheck() {
    const snapshot = formRef.current
    // 金额为空 / 非正不发请求（避免无意义 400）。
    if (!snapshot.amount.trim() || Number(snapshot.amount) <= 0) {
      setResult(null)
      setErr(null)
      setLoading(false)
      return
    }
    const seq = ++seqRef.current
    setLoading(true)
    setErr(null)
    try {
      const data = await approvalCheck({
        amount: snapshot.amount.trim(),
        budgetCategory: snapshot.budgetCategory,
        payee: snapshot.payee.trim(),
        hasSettlementDoc: snapshot.hasSettlementDoc,
        purpose: snapshot.purpose.trim(),
        month: DASH_MONTH,
      })
      if (seq !== seqRef.current) return // 已有更新的请求，丢弃本次
      setResult(data)
    } catch (e) {
      if (seq !== seqRef.current) return
      setErr(e instanceof ApiError ? e.message : '判断失败')
      setResult(null)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }

  // 输入即防抖实时判（450ms）。初次挂载也会触发，跑出默认红灯示例。
  useEffect(() => {
    const id = setTimeout(() => void runCheck(), 450)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

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
              支出审批判断卡 · Approval Check
            </div>
            <span className="calc-tag">确定性规则 · 可复算</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--dimmer)' }}>
            录入一笔拟付款 → 5 条规则逐条判断 → 总灯取最严，给出证据来源与建议责任人。只读判断 · 不发起付款。
          </div>
        </div>

        <div className="grid" style={{ marginTop: 16 }}>
          {/* ---- 左：拟付款录入 ---- */}
          <ApprovalForm form={form} patch={patch} loading={loading} onCheck={() => void runCheck()} />

          {/* ---- 右：判断结果 / 证据链 ---- */}
          <div className="panel" style={{ animationDelay: '.1s' }}>
            <div className="phead">
              <div className="t">
                <b />
                判断结果 · 证据链
              </div>
              {result?.isPlaceholder && (
                <span className="calc-tag amber">demo 数据 · 待财务复核</span>
              )}
            </div>

            {loading && !result ? (
              <Loading msg="正在跑规则判断…" />
            ) : err ? (
              <ErrorState
                msg={err}
                sub="请确认后端已启动 (127.0.0.1:8000) 后重试"
                onRetry={() => void runCheck()}
              />
            ) : !result ? (
              <div className="state-box">
                <div className="ico">∅</div>
                <div className="msg">填写拟付款信息后自动判断</div>
                <div className="sub">金额需大于 0</div>
              </div>
            ) : (
              <ResultView result={result} unit={unit} dimmed={loading} />
            )}
          </div>
        </div>

        {/* 底部固定声明 */}
        <div className="footnote" style={{ marginTop: 16 }}>
          <span style={{ color: 'var(--cyan)', fontFamily: 'var(--disp)', letterSpacing: 1 }}>
            只读判断 · 不发起付款
          </span>
          <span>
            <i style={{ background: 'var(--green)' }} />
            可批
          </span>
          <span>
            <i style={{ background: 'var(--amber)' }} />
            需复核
          </span>
          <span>
            <i style={{ background: 'var(--red)' }} />
            不建议批
          </span>
          <span style={{ color: 'var(--dimmer)' }}>
            规则确定性推导 · 收款方原文已脱敏入审计 · 完整态势见{' '}
            <Link to="/" style={{ color: 'var(--cyan)' }}>
              驾驶舱
            </Link>
          </span>
        </div>
      </div>
    </>
  )
}

// ---- 左侧录入卡 ----
function ApprovalForm({
  form,
  patch,
  loading,
  onCheck,
}: {
  form: FormState
  patch: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  loading: boolean
  onCheck: () => void
}) {
  return (
    <div className="panel" style={{ animationDelay: '.07s' }}>
      <div className="phead">
        <div className="t">
          <b />
          拟付款录入
        </div>
        <span style={{ fontSize: 11, color: 'var(--dimmer)', fontFamily: 'var(--disp)', letterSpacing: 1 }}>
          输入即判
        </span>
      </div>

      <FieldLabel>拟付金额（元）</FieldLabel>
      <input
        className="field-in"
        type="number"
        inputMode="decimal"
        min="0"
        step="1000"
        value={form.amount}
        onChange={(e) => patch('amount', e.target.value)}
        placeholder="如 600000"
      />

      <div className="section-gap">
        <FieldLabel>预算归属科目</FieldLabel>
        <select
          className="field-in"
          value={form.budgetCategory}
          onChange={(e) => patch('budgetCategory', e.target.value as BudgetCategory)}
          style={{ appearance: 'auto' }}
        >
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="section-gap">
        <FieldLabel>收款方</FieldLabel>
        <input
          className="field-in"
          type="text"
          value={form.payee}
          onChange={(e) => patch('payee', e.target.value)}
          placeholder="如 某供应商 / 投放渠道"
          style={{ fontFamily: 'var(--cn)', letterSpacing: 0 }}
        />
      </div>

      <div className="section-gap">
        <FieldLabel>用途</FieldLabel>
        <input
          className="field-in"
          type="text"
          value={form.purpose}
          onChange={(e) => patch('purpose', e.target.value)}
          placeholder="如 服务器采购"
          style={{ fontFamily: 'var(--cn)', letterSpacing: 0 }}
        />
      </div>

      {/* 有无合同/结算单 —— 开关 */}
      <label
        className="section-gap"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          background: 'var(--panel-2)',
          border: '1px solid var(--hairline-2)',
          borderRadius: 9,
          padding: '12px 14px',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 14, color: 'var(--text)' }}>
          已附合同 / 结算单
          <span style={{ display: 'block', fontSize: 11, color: 'var(--dimmer)', marginTop: 2 }}>
            大额支出无单据将不予放行
          </span>
        </span>
        <input
          type="checkbox"
          checked={form.hasSettlementDoc}
          onChange={(e) => patch('hasSettlementDoc', e.target.checked)}
          style={{ width: 20, height: 20, accentColor: 'var(--cyan)', cursor: 'pointer', flexShrink: 0 }}
        />
      </label>

      <button
        className="btn-primary"
        onClick={onCheck}
        disabled={loading || !form.amount.trim() || Number(form.amount) <= 0}
      >
        {loading ? '判断中…' : '判断'}
      </button>
      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--dimmer)', lineHeight: 1.5 }}>
        只读判断引擎 · 不发起任何付款 / 打款 · 金额与收款方仅用于本次规则计算
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="field-lab">{children}</label>
}

// ---- 右侧结果视图 ----
function ResultView({
  result,
  unit,
  dimmed,
}: {
  result: ApprovalCheckResp
  unit: 'yuan' | 'wan'
  dimmed: boolean
}) {
  const total = TOTAL_LIGHT[result.light]
  const catLabel = useMemo(
    () => CATEGORY_OPTIONS.find((c) => c.value === result.budgetCategory)?.label ?? result.budgetCategory,
    [result.budgetCategory]
  )

  return (
    <div style={{ opacity: dimmed ? 0.55 : 1, transition: 'opacity .15s' }}>
      {/* 总灯（大号） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '18px 20px',
          borderRadius: 10,
          border: `1px solid ${total.tone}`,
          background: `color-mix(in srgb, ${total.tone} 10%, transparent)`,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: total.tone,
            boxShadow: `0 0 16px ${total.tone}`,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--disp)',
              fontWeight: 600,
              fontSize: 30,
              letterSpacing: 1,
              color: total.tone,
              lineHeight: 1.1,
            }}
          >
            {total.label}
          </div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
            拟付 <span className="num" style={{ color: 'var(--text)' }}>{moneyU(result.amount, unit, 2)}</span>
            {' · '}
            {catLabel}
          </div>
        </div>
      </div>

      {/* 例外横幅 */}
      {result.exceptions.length > 0 && (
        <div
          style={{
            marginTop: 14,
            border: '1px solid rgba(251,190,60,.35)',
            background: 'rgba(251,190,60,.08)',
            borderRadius: 9,
            padding: '12px 14px',
          }}
        >
          <div style={{ fontFamily: 'var(--disp)', fontSize: 11, letterSpacing: 1, color: 'var(--amber)', marginBottom: 6 }}>
            例外提示
          </div>
          {result.exceptions.map((ex, i) => (
            <div key={i} style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
              · {ex}
            </div>
          ))}
        </div>
      )}

      {/* 剩余额度 + 建议责任人 */}
      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        <div
          style={{
            flex: 1,
            minWidth: 160,
            background: 'var(--panel-2)',
            border: '1px solid var(--hairline)',
            borderRadius: 9,
            padding: '12px 14px',
          }}
        >
          <div className="eyebrow">剩余额度</div>
          <div
            className="num"
            style={{
              fontSize: 20,
              fontWeight: 700,
              marginTop: 4,
              color:
                result.remainingBudget == null
                  ? 'var(--dim)'
                  : result.remainingBudget.startsWith('-')
                    ? 'var(--red)'
                    : 'var(--text)',
            }}
          >
            {result.remainingBudget == null ? '不设上限' : moneyU(result.remainingBudget, unit, 2)}
          </div>
          {result.remainingBudget == null && (
            <div style={{ fontSize: 11, color: 'var(--dimmer)', marginTop: 2 }}>按计划，无预算上限</div>
          )}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 160,
            background: 'var(--panel-2)',
            border: '1px solid var(--hairline)',
            borderRadius: 9,
            padding: '12px 14px',
          }}
        >
          <div className="eyebrow">建议责任人</div>
          <div style={{ marginTop: 8 }}>
            <span className="pill cyan">{result.owner}</span>
          </div>
        </div>
      </div>

      {/* 命中规则逐条 */}
      <div style={{ marginTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          命中规则逐条
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {result.rules.map((r) => {
            const lt = RULE_LIGHT[r.light]
            const isNa = r.light === 'na'
            return (
              <div
                key={r.key}
                style={{
                  border: '1px solid var(--hairline)',
                  borderLeft: `3px solid ${lt.tone}`,
                  borderRadius: 8,
                  padding: '12px 14px',
                  opacity: isNa ? 0.62 : 1,
                  background: isNa ? 'transparent' : 'var(--panel-2)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background: lt.dot,
                        boxShadow: isNa ? 'none' : `0 0 8px ${lt.dot}`,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontFamily: 'var(--disp)', fontSize: 13, letterSpacing: 0.5, color: 'var(--text)' }}>
                      {r.name}
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: 10,
                      letterSpacing: 1,
                      color: lt.tone,
                      border: `1px solid ${lt.tone}`,
                      borderRadius: 999,
                      padding: '1px 8px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {lt.label}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.6, marginTop: 8 }}>
                  {r.detail}
                </div>
                <div style={{ fontSize: 11, color: 'var(--dimmer)', marginTop: 6 }}>
                  证据来源：{r.evidenceSource}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {result.isPlaceholder && (
        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--dimmer)', lineHeight: 1.5 }}>
          demo 数据 · 待接入真实数据源 / 待财务复核 —— 不可当真实批付结论。
        </div>
      )}
    </div>
  )
}
