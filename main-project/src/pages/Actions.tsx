// 今日行动清单（Layer 0 · 老板每天只看这一页）。
// 直接展示后端 task 表生成的风险任务，并把完成动作回写后端。
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listRiskTasks, updateRiskTask, ApiError } from '../api'
import type { RiskTask } from '../api/types'
import { TopBar } from '../components/TopBar'
import { Loading, ErrorState } from '../components/StateBox'

type Level = 'red' | 'amber' | 'green'
const LEVEL_COLOR: Record<Level, string> = {
  red: 'var(--red)',
  amber: 'var(--amber)',
  green: 'var(--green)',
}
const LEVEL_LABEL: Record<Level, string> = { red: '高', amber: '关注', green: '正常' }
const LEVEL_ORDER: Record<Level, number> = { red: 0, amber: 1, green: 2 }

// 动作条：聚合后的一条「今天要做的事」。
interface Action {
  id: string
  level: Level
  title: string // 动作标题
  context: string // 关键上下文（金额/逾期/百分比）
  owner: string
  to: string // 去处理跳转路由
  task: RiskTask
}

interface ActionsData {
  tasks: RiskTask[]
}

function buildActions(d: ActionsData): Action[] {
  return d.tasks.map((task): Action => ({
    id: task.id,
    level: task.riskLevel === 'yellow' ? 'amber' : task.riskLevel,
    title: task.title,
    context: `截止 ${task.dueDate} · ${task.bossInterventionRequired ? '需老板介入' : '责任人处理'}`,
    owner: task.ownerName || task.ownerCode || '待指派',
    to: task.taskType === 'collection_overdue' ? '/repayment' : '/',
    task,
  })).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.task.dueDate.localeCompare(b.task.dueDate))
}

export function Actions() {
  const [data, setData] = useState<ActionsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const tasks = await listRiskTasks()
      setData({ tasks })
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
        <TopBar periodLabel="今日清单" />
        <div className="wrap">
          <div className="panel">
            <Loading msg="正在聚合今日待办动作…" />
          </div>
        </div>
      </>
    )
  }
  if (err || !data) {
    return (
      <>
        <TopBar periodLabel="今日清单" />
        <div className="wrap">
          <div className="panel">
            <ErrorState
              msg={err || '加载失败'}
              sub="请确认后端已启动 (127.0.0.1:8000) 后重试"
              onRetry={() => void load()}
            />
          </div>
        </div>
      </>
    )
  }

  return <ActionsView data={data} />
}

const MAX_VISIBLE = 5

function ActionsView({ data }: { data: ActionsData }) {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState(data.tasks)
  const [updateErr, setUpdateErr] = useState<string | null>(null)
  const actions = useMemo(() => buildActions({ tasks }), [tasks])

  async function complete(action: Action) {
    if (action.task.status === 'completed' || action.task.status === 'closed') return
    setUpdateErr(null)
    try {
      const updated = await updateRiskTask(action.id, 'completed', action.task.version)
      setTasks((current) => current.map((task) => task.id === action.id
        ? { ...task, status: updated.status, version: updated.version }
        : task))
    } catch (e) {
      setUpdateErr(e instanceof ApiError ? e.message : '任务更新失败')
    }
  }

  const pending = actions.filter((a) => a.task.status === 'pending' || a.task.status === 'in_progress')
  const pendingCount = pending.length
  const visible = actions.slice(0, MAX_VISIBLE)
  const overflow = actions.length - visible.length

  const allClear = pendingCount === 0

  return (
    <>
      <TopBar periodLabel="今日清单" />
      <div className="scan" />

      <div className="wrap">
        {/* 头条：今日 N 件待办 */}
        <div className="panel" style={{ animationDelay: '.04s' }}>
          <div className="phead" style={{ marginBottom: 6 }}>
            <div className="t">
              <b />
              今日行动清单 · Today&apos;s Actions
            </div>
            <span className="calc-tag">实时聚合 · 各规则引擎</span>
          </div>

          <div className="gap-wrap" style={{ marginTop: 10, flexWrap: 'wrap', gap: 20 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                今日待办
              </div>
              {allClear ? (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                  <span
                    className="num"
                    style={{ fontSize: 56, fontWeight: 800, lineHeight: 0.95, color: 'var(--green)' }}
                  >
                    0
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)', paddingBottom: 8 }}>
                    现金流今日无需动作
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <span
                    className="num"
                    style={{
                      fontSize: 64,
                      fontWeight: 800,
                      lineHeight: 0.95,
                      color: 'var(--red)',
                      textShadow: '0 0 28px rgba(216,58,87,0.35)',
                    }}
                  >
                    {pendingCount}
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--dim)', paddingBottom: 8 }}>
                    件待办
                  </span>
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--dimmer)', marginTop: 4 }}>
                {new Date().toLocaleDateString('zh-CN')} · 已按风险等级与截止日期排序
              </div>
            </div>
          </div>
        </div>

        {/* 动作卡列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          {allClear && actions.length === 0 ? (
            <div className="panel" style={{ animationDelay: '.08s' }}>
              <div className="state-box">
                <div className="ico" style={{ color: 'var(--green)' }}>
                  ✓
                </div>
                <div className="msg" style={{ color: 'var(--green)' }}>
                  现金流今日无需动作
                </div>
                <div className="sub">各战线均在安全区，无待处理事项</div>
              </div>
            </div>
          ) : (
            visible.map((a, i) => (
              <ActionCard
                key={a.id}
                action={a}
                index={i + 1}
                done={a.task.status === 'completed' || a.task.status === 'closed'}
                onGo={() => navigate(a.to)}
                onToggleDone={() => void complete(a)}
                delay={0.08 + i * 0.05}
              />
            ))
          )}

          {overflow > 0 && (
            <div
              className="panel"
              style={{
                animationDelay: `${0.08 + visible.length * 0.05}s`,
                padding: '14px 24px',
                textAlign: 'center',
                color: 'var(--dim)',
                fontSize: 13,
              }}
            >
              另有 {overflow} 项较低优先级动作 · 已折叠（按规则可在对应模块查看完整态势）
            </div>
          )}
        </div>

        {updateErr && <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 13 }}>{updateErr}</div>}

        {/* 底部声明 */}
        <div className="footnote" style={{ marginTop: 18 }}>
          <span>
            <i style={{ background: 'var(--red)' }} />高 · 需立即处置
          </span>
          <span>
            <i style={{ background: 'var(--amber)' }} />关注 · 建议跟进
          </span>
          <span style={{ color: 'var(--dimmer)' }}>
            数据来自后端风险任务表 · 「今日完成」会更新真实任务状态，不发起任何资金动作
          </span>
        </div>
      </div>
    </>
  )
}

function ActionCard({
  action,
  index,
  done,
  onGo,
  onToggleDone,
  delay,
}: {
  action: Action
  index: number
  done: boolean
  onGo: () => void
  onToggleDone: () => void
  delay: number
}) {
  const col = LEVEL_COLOR[action.level]
  return (
    <div
      className="panel"
      style={{
        animationDelay: `${delay}s`,
        borderLeft: `3px solid ${col}`,
        padding: '18px 22px',
        opacity: done ? 0.62 : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        {/* 序号 + 灯点 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span
            className="num"
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: 'var(--dimmer)',
              minWidth: 26,
              textAlign: 'right',
            }}
          >
            {index}
          </span>
          <span
            style={{
              width: 11,
              height: 11,
              borderRadius: '50%',
              background: col,
              boxShadow: `0 0 9px ${col}`,
              flexShrink: 0,
            }}
          />
        </div>

        {/* 主体 */}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--text)',
                textDecoration: done ? 'line-through' : 'none',
              }}
            >
              {action.title}
            </span>
            <span
              style={{
                fontFamily: 'var(--disp)',
                fontSize: 10,
                letterSpacing: 1,
                color: col,
                border: `1px solid ${col}`,
                borderRadius: 999,
                padding: '1px 9px',
                whiteSpace: 'nowrap',
              }}
            >
              {LEVEL_LABEL[action.level]}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.6, marginTop: 6 }}>
            {action.context}
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, letterSpacing: 1, color: 'var(--dimmer)', fontFamily: 'var(--disp)' }}>
              责任人
            </span>
            <span className="pill cyan">{action.owner}</span>
          </div>
        </div>

        {/* 动作区 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'stretch',
            flexShrink: 0,
            minWidth: 120,
          }}
        >
          <button
            onClick={onGo}
            style={{
              fontFamily: 'var(--disp)',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0.5,
              color: col,
              border: `1px solid ${col}`,
              background: 'transparent',
              borderRadius: 8,
              padding: '9px 16px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            去处理 →
          </button>
          <button
            onClick={onToggleDone}
            style={{
              fontFamily: 'var(--disp)',
              fontSize: 12,
              letterSpacing: 0.5,
              color: done ? 'var(--green)' : 'var(--dim)',
              border: `1px solid ${done ? 'rgba(15,158,107,0.4)' : 'var(--hairline-2)'}`,
              background: done ? 'rgba(15,158,107,0.1)' : 'transparent',
              borderRadius: 8,
              padding: '8px 16px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {done ? '✓ 今日已完成' : '今日完成'}
          </button>
        </div>
      </div>
    </div>
  )
}
