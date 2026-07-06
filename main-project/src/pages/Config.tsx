// 参数配置页：营收/比例/账期/置信阈值/band（/api/config）。占位值标「待财务复核」。
import { useEffect, useState } from 'react'
import { listConfig, setConfig, ApiError } from '../api'
import type { ConfigParam } from '../api/types'
import { TopBar } from '../components/TopBar'
import { Loading, ErrorState } from '../components/StateBox'

// 参数键的中文标签 + 输入提示（仅展示用，定义以后端 note 为准）
const KEY_LABEL: Record<string, { name: string; hint: string }> = {
  revenue_base: { name: '年营收基数', hint: '元 · 阈值公式用 (营收×比例)÷12' },
  ga_ratio: { name: '管理费用比例', hint: '小数 · 如 0.02 = 2%' },
  account_period_months: { name: '账期月数', hint: '月 · 投入到全部回款的回收周期' },
  confidence_threshold: { name: '置信阈值', hint: '0~1 · 低于此值标待人工确认' },
  green_band: { name: '绿灯上限', hint: '占阈值比例 · ≤ 此值为绿' },
  yellow_band: { name: '黄灯上限', hint: '占阈值比例 · 绿~此值为黄,超出为红' },
}

// 展示顺序
const ORDER = [
  'revenue_base',
  'ga_ratio',
  'account_period_months',
  'confidence_threshold',
  'green_band',
  'yellow_band',
]

export function Config() {
  const [params, setParams] = useState<ConfigParam[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const data = await listConfig()
      // 按 ORDER 排序，未知键置尾
      const sorted = [...data].sort(
        (a, b) =>
          (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99)
      )
      setParams(sorted)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function onSaved(updated: ConfigParam) {
    setParams((prev) => prev.map((p) => (p.key === updated.key ? updated : p)))
  }

  return (
    <>
      <TopBar periodLabel="参数配置" />
      <div className="scan" />
      <div className="wrap">
        {/* ④ 财务复核入口：列出所有占位参数，逐项确认去占位。 */}
        {!loading && !err && <ReviewPanel params={params} onSaved={onSaved} />}

        <div className="panel" style={{ animationDelay: '.05s' }}>
          <div className="phead">
            <div className="t">
              <b />
              参数配置 · Parameters
            </div>
            <div className="calc-tag amber">改营收 / 比例 / 账期后聚合即时重算</div>
          </div>

          {loading ? (
            <Loading msg="加载参数…" />
          ) : err ? (
            <ErrorState msg={err} onRetry={load} />
          ) : (
            <div className="cfg-grid">
              {params.map((p) => (
                <ConfigCard key={p.key} param={p} onSaved={onSaved} />
              ))}
            </div>
          )}

          <div className="footnote">
            <span style={{ color: 'var(--dimmer)' }}>
              标「待财务复核」的为占位值,复核确认并保存后自动去占位标识。
            </span>
            <span style={{ color: 'var(--dimmer)' }}>
              所有改动写入后端审计日志 · 金额禁用浮点(后端 Decimal)。
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

function ConfigCard({
  param,
  onSaved,
}: {
  param: ConfigParam
  onSaved: (p: ConfigParam) => void
}) {
  const meta = KEY_LABEL[param.key] || { name: param.key, hint: param.note || '' }
  const [value, setValue] = useState(param.value)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // 外部刷新时同步
  useEffect(() => {
    setValue(param.value)
  }, [param.value])

  const dirty = value.trim() !== param.value.trim()

  async function save() {
    if (!dirty || saving) return
    setSaving(true)
    setMsg(null)
    try {
      const updated = await setConfig(param.key, value.trim())
      onSaved(updated)
      setMsg({ type: 'ok', text: '已保存' + (updated.isPlaceholder ? '' : ' · 已去占位') })
    } catch (e) {
      // 后端校验失败(超范围等)友好提示
      setMsg({ type: 'err', text: e instanceof ApiError ? e.message : '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cfg-item">
      <div className="key">
        {meta.name}
        {param.isPlaceholder && <span className="place-tag" style={{ marginLeft: 8 }}>待财务复核</span>}
      </div>
      <div className="note">{param.note || meta.hint}</div>
      <div className="cfg-row">
        <input
          className="cfg-in"
          value={value}
          inputMode="decimal"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
          aria-label={meta.name}
        />
        <button className="cfg-save" onClick={save} disabled={!dirty || saving}>
          {saving ? '保存中' : '保存'}
        </button>
      </div>
      {msg && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: msg.type === 'ok' ? 'var(--green)' : 'var(--red)',
          }}
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}

// ---- ④ 财务复核面板 ----
// 列出所有 isPlaceholder=true 的参数；逐项「确认无误」(可改值后确认) → setConfig 把后端 is_placeholder 置 false。
// 确认后该项从待复核移除（params 更新后 isPlaceholder=false 自然不再入列）、进度 +1。
function ReviewPanel({
  params,
  onSaved,
}: {
  params: ConfigParam[]
  onSaved: (p: ConfigParam) => void
}) {
  const total = params.length
  const pending = params.filter((p) => p.isPlaceholder)
  const reviewed = total - pending.length
  const allDone = total > 0 && pending.length === 0

  return (
    <div className="panel" style={{ animationDelay: '.04s', marginBottom: 16 }}>
      <div className="phead">
        <div className="t">
          <b />
          财务复核 · Review
        </div>
        {allDone ? (
          <span
            className="pill green"
            style={{ fontFamily: 'var(--disp)', fontSize: 11, letterSpacing: 1 }}
          >
            ✓ 已全部复核
          </span>
        ) : (
          <span className="calc-tag amber">{`${reviewed} / ${total} 项已复核 · 余 ${pending.length} 项待确认`}</span>
        )}
      </div>

      {allDone ? (
        <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.6 }}>
          全部参数已由财务复核确认，作为真实结论参与计算，不再标「待财务复核」。
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--dimmer)', lineHeight: 1.6, marginBottom: 14 }}>
            以下参数仍为占位值（营收 / 比例 / 账期 / 各科目预算 / 门槛等）。逐项核对，可直接「确认无误」或改值后确认；
            确认后该数字不再标「待财务复核」，将作为真实结论参与计算。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pending.map((p) => (
              <ReviewRow key={p.key} param={p} onSaved={onSaved} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ReviewRow({
  param,
  onSaved,
}: {
  param: ConfigParam
  onSaved: (p: ConfigParam) => void
}) {
  const meta = KEY_LABEL[param.key] || { name: param.key, hint: param.note || '' }
  const [value, setValue] = useState(param.value)
  const [saving, setSaving] = useState(false)
  const [rowErr, setRowErr] = useState<string | null>(null)

  useEffect(() => {
    setValue(param.value)
  }, [param.value])

  // 确认无误：把当前编辑框的值（默认即原值）写回 → 后端去占位。
  async function confirm() {
    if (saving) return
    setSaving(true)
    setRowErr(null)
    try {
      const updated = await setConfig(param.key, value.trim())
      onSaved(updated) // params 更新后 isPlaceholder=false，本行从待复核列表移除
    } catch (e) {
      setRowErr(e instanceof ApiError ? e.message : '确认失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--hairline)',
        borderLeft: '3px solid var(--amber)',
        borderRadius: 8,
        padding: '14px 16px',
        background: 'var(--panel-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{meta.name}</span>
            <span className="place-tag">待财务复核</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4, lineHeight: 1.5 }}>
            {param.note || meta.hint}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <input
            className="cfg-in"
            style={{ width: 150, flex: 'none' }}
            value={value}
            inputMode="decimal"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirm()
            }}
            aria-label={`${meta.name} 当前值`}
          />
          <button
            onClick={() => void confirm()}
            disabled={saving}
            style={{
              fontFamily: 'var(--disp)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.5,
              color: 'var(--green)',
              border: '1px solid rgba(15,158,107,0.4)',
              background: 'rgba(15,158,107,0.1)',
              borderRadius: 8,
              padding: '9px 16px',
              cursor: saving ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '确认中…' : '确认无误'}
          </button>
        </div>
      </div>
      {rowErr && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red)' }}>{rowErr}</div>}
    </div>
  )
}
