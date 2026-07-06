// 经营 AI 副驾 · 对话窗口（产品门面 / 老板首屏）。
// 老板用自然语言问 → 后端意图路由调确定性规则引擎 → 人话作答 + 证据卡 + 可下钻。
// 铁律：AI 只做"听懂 + 表达"，所有数字来自规则引擎；本页只读问答，不发起任何资金动作。
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { copilotChat, health, ApiError } from '../api'
import type { CopilotChatResp } from '../api/types'
import { TopBar } from '../components/TopBar'

interface Msg {
  role: 'user' | 'assistant'
  text?: string // 用户文本
  resp?: CopilotChatResp // AI 结构化回答
  error?: boolean
}

const SUGGESTIONS = [
  '这个月现金够不够?',
  '这笔10万办公采购能批吗?',
  '今天该追谁回款?',
  '管理费用还能花多少?',
  '现金什么时候转正?',
]

const LIGHT_COLOR: Record<string, string> = {
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
  na: 'var(--dimmer)',
}

// card 字段中文标签（按各 intent 可能出现的键友好显示；未知键回退原键）
const FACT_LABEL: Record<string, string> = {
  gap: '缺口',
  plannedOutflow: '计划支出',
  availableCash: '可用现金',
  monthlyThreshold: '月阈值',
  used: '已用',
  remaining: '剩余',
  remainingBudget: '剩余额度',
  owner: '责任人',
  budgetCategory: '科目',
  amount: '金额',
  todayCount: '今日待处理',
  overdueCount: '逾期笔数',
  overdueAmount: '逾期金额',
  turnPositiveMonth: '转正月份',
  customer: '客户',
  overdueDays: '逾期天数',
}

const GREETING =
  '我是经营 AI 副驾。你用大白话问，我去调现金流/审批/回款这些规则引擎,把确定的结果用人话讲给你听,数字都可追溯。试试下面的问题,或者直接问我。'

function factEntries(card: Record<string, unknown> | null | undefined): [string, string][] {
  if (!card) return []
  const out: [string, string][] = []
  for (const [k, v] of Object.entries(card)) {
    if (v === null || v === undefined) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out.push([FACT_LABEL[k] ?? k, String(v)])
    }
    if (out.length >= 4) break
  }
  return out
}

export function Copilot() {
  const navigate = useNavigate()
  const [downgraded, setDowngraded] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([{ role: 'assistant', text: GREETING }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    health()
      .then((h) => setDowngraded(!h.llmEnabled))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, loading])

  async function send(text: string) {
    const msg = text.trim()
    if (!msg || loading) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: msg }])
    setLoading(true)
    try {
      const resp = await copilotChat(msg)
      setMessages((m) => [...m, { role: 'assistant', resp }])
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: e instanceof ApiError ? e.message : '出错了,请重试', error: true },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <TopBar downgraded={downgraded} periodLabel="经营 AI 副驾" />
      <div className="scan" />
      <div className="wrap" style={{ maxWidth: 940 }}>
        <div
          className="panel"
          style={{ display: 'flex', flexDirection: 'column', height: 'min(76vh, 760px)', padding: '20px 22px' }}
        >
          <div className="phead" style={{ marginBottom: 12 }}>
            <div className="t">
              <b />
              经营 AI 副驾 · Cashflow Copilot
            </div>
            <div className="calc-tag">AI 听懂与表达 · 数字由规则引擎确定性计算</div>
          </div>

          {/* 消息区 */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px' }}>
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <UserBubble key={i} text={m.text || ''} />
              ) : (
                <AssistantBubble key={i} msg={m} onNav={(l) => navigate(l)} />
              )
            )}
            {loading && (
              <div style={bubbleWrap('assistant')}>
                <div style={{ ...assistantBubbleStyle, color: 'var(--dim)' }}>
                  <span className="dot" style={{ display: 'inline-block', marginRight: 8, background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)' }} />
                  AI 思考中…
                </div>
              </div>
            )}
          </div>

          {/* 推荐问法 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0 10px' }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={loading}
                style={{
                  fontFamily: 'var(--cn)',
                  fontSize: 12,
                  color: 'var(--cyan)',
                  border: '1px solid rgba(14,143,160,.3)',
                  background: 'var(--cyan-soft)',
                  borderRadius: 999,
                  padding: '6px 12px',
                  cursor: loading ? 'default' : 'pointer',
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* 输入区 */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
              rows={1}
              placeholder="问问现金、审批、回款…（Enter 发送,Shift+Enter 换行）"
              style={{
                flex: 1,
                resize: 'none',
                background: 'var(--panel-2)',
                border: '1px solid var(--hairline-2)',
                borderRadius: 10,
                padding: '11px 14px',
                color: 'var(--text)',
                fontFamily: 'var(--cn)',
                fontSize: 14,
                lineHeight: 1.5,
                maxHeight: 120,
              }}
            />
            <button
              className="btn-primary"
              style={{ width: 'auto', margin: 0, padding: '11px 22px' }}
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
            >
              发送
            </button>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--dimmer)' }}>
            只读问答 · 不发起任何资金动作 · 占位数字标「待财务复核」
            {downgraded && ' · 规则问答模式(接入通义后升级为完整自然语言)'}
          </div>
        </div>
      </div>
    </>
  )
}

function bubbleWrap(role: 'user' | 'assistant'): React.CSSProperties {
  return { display: 'flex', justifyContent: role === 'user' ? 'flex-end' : 'flex-start' }
}

const assistantBubbleStyle: React.CSSProperties = {
  maxWidth: '82%',
  background: 'var(--panel-2)',
  border: '1px solid var(--hairline)',
  borderRadius: '12px 12px 12px 4px',
  padding: '13px 16px',
  fontSize: 14,
  lineHeight: 1.65,
  color: 'var(--text)',
}

function UserBubble({ text }: { text: string }) {
  return (
    <div style={bubbleWrap('user')}>
      <div
        style={{
          maxWidth: '82%',
          background: 'var(--cyan-soft)',
          border: '1px solid rgba(14,143,160,.25)',
          borderRadius: '12px 12px 4px 12px',
          padding: '11px 15px',
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </div>
  )
}

function AssistantBubble({ msg, onNav }: { msg: Msg; onNav: (link: string) => void }) {
  if (msg.text) {
    // 纯文本（欢迎语 / 报错）
    return (
      <div style={bubbleWrap('assistant')}>
        <div style={{ ...assistantBubbleStyle, color: msg.error ? 'var(--red)' : 'var(--text)' }}>{msg.text}</div>
      </div>
    )
  }
  const r = msg.resp
  if (!r) return null
  const facts = factEntries(r.card)
  const lightCol = r.light ? LIGHT_COLOR[r.light] : null
  return (
    <div style={bubbleWrap('assistant')}>
      <div style={assistantBubbleStyle}>
        <div style={{ whiteSpace: 'pre-wrap' }}>{r.answer}</div>

        {(lightCol || facts.length > 0 || r.link) && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--hairline)',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
            }}
          >
            {lightCol && (
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: lightCol, boxShadow: `0 0 8px ${lightCol}`, flexShrink: 0 }} />
            )}
            {facts.map(([k, v]) => (
              <span key={k} style={{ fontSize: 12, color: 'var(--dim)' }}>
                <span style={{ color: 'var(--dimmer)' }}>{k} </span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{v}</span>
              </span>
            ))}
            {r.isPlaceholder && <span className="place-tag">待财务复核</span>}
            {r.link && (
              <button
                onClick={() => onNav(r.link as string)}
                style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--disp)',
                  fontSize: 12,
                  color: 'var(--cyan)',
                  border: '1px solid rgba(14,143,160,.3)',
                  background: 'transparent',
                  borderRadius: 6,
                  padding: '5px 12px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                查看详情 →
              </button>
            )}
          </div>
        )}

        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--dimmer)' }}>
          {r.source}
          {!r.llmUsed && ' · 规则问答'}
        </div>
      </div>
    </div>
  )
}
