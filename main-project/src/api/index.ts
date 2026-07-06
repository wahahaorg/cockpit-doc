// API 模块聚合（§8 全量接口）。组件只从这里调，不直接 fetch。
import Decimal from 'decimal.js'
import { apiGet, apiPatch, apiPost, apiSse, apiUpload } from './client'
import type {
  LoginResp,
  HealthResp,
  ImportResp,
  ClassificationRunResp,
  ClassificationListResp,
  ClassificationItem,
  CashGapResp,
  ForecastResp,
  GAThresholdResp,
  GACheckResp,
  ConfigParam,
  Axis,
  ApprovalCheckReq,
  ApprovalCheckResp,
  RepaymentRisksResp,
  RepaymentRiskItem,
  ReceivableRiskRecord,
  RiskTask,
  RiskTaskStatus,
  TaskPatchResp,
  CopilotChatResp,
  CashflowForecastResp,
  ReceivableRiskTopResp,
  PaymentRecommendationExplanationResp,
  PaymentRecommendationTopResp,
  DecisionEvent,
} from './types'

// ---- §8.6 登录 ----（口令走 body，不走 URL）
export const login = (passcode: string) =>
  apiPost<LoginResp>('/api/auth/login', { passcode }, /* auth */ false)

// ---- 健康检查（无需鉴权）----
export const health = () => apiGet<HealthResp>('/api/health', undefined, false)

// ---- §8.1 流水导入 ----
export const importTransactions = (file: File, fieldMapping?: Record<string, string>) => {
  const fd = new FormData()
  fd.append('file', file)
  if (fieldMapping) fd.append('fieldMapping', JSON.stringify(fieldMapping))
  return apiUpload<ImportResp>('/api/transactions/import', fd)
}

// ---- §8.2 触发 / 查询分类 ----
export const runClassification = (importBatchId: number, onlyTxnIds: number[] | null = null) =>
  apiPost<ClassificationRunResp>('/api/classification/run', { importBatchId, onlyTxnIds })

export const listClassification = (params: {
  batchId?: number
  needReview?: boolean
  axis?: Axis
  page?: number
  pageSize?: number
}) => apiGet<ClassificationListResp>('/api/classification', params as Record<string, string | number | boolean | undefined>)

// ---- §8.3 人工改标 ----（newAxis 走 body）
export const relabel = (classificationId: number, newAxis: Axis, reason?: string) =>
  apiPost<ClassificationItem>(`/api/classification/${classificationId}/relabel`, { newAxis, reason })

// ---- §8.4 驾驶舱聚合 ----
export const cashGap = (month?: string) =>
  apiGet<CashGapResp>('/api/dashboard/cashgap', { month })

// forecast 的 from 是保留字，按 API_DOC 原样传 from/to
export const forecast = (from: string, to: string) =>
  apiGet<ForecastResp>('/api/dashboard/forecast', { from, to })

export const gaThreshold = (month?: string) =>
  apiGet<GAThresholdResp>('/api/dashboard/ga-threshold', { month })

// 金额走 body（只读预警，不发起付款）
export const gaCheck = (amount: string, month?: string) =>
  apiPost<GACheckResp>('/api/dashboard/ga-check', { amount, month })

// ---- Layer 2 · 支出审批判断 ----（金额/收款方走 body，不走 URL；只读判断，不发起付款）
export const approvalCheck = (body: ApprovalCheckReq) =>
  apiPost<ApprovalCheckResp>('/api/approval/check', body)

// ---- Layer 2 · 回款风险引擎 ----（只读风险态势 + 仅记跟进，不碰资金）
export async function repaymentRisks(asOf = new Date().toISOString().slice(0, 10)): Promise<RepaymentRisksResp> {
  const rows = await apiGet<ReceivableRiskRecord[]>('/api/v1/receivable-risks', { asOfDate: asOf })
  const asOfTime = new Date(`${asOf}T00:00:00`).getTime()
  const items: RepaymentRiskItem[] = rows.map((row) => {
    const outstanding = Number(row.outstandingAmount)
    const received = outstanding <= 0
    const daysToDue = received
      ? 0
      : Math.round((new Date(`${row.agreedDueDate}T00:00:00`).getTime() - asOfTime) / 86400000)
    return {
      id: row.receivableId,
      customer: row.customerName,
      summary: `${row.receivableNo} · 未回 ${row.outstandingAmount} 元`,
      expectedAmount: row.outstandingAmount,
      dueDate: row.agreedDueDate,
      status: received ? 'received' : 'pending',
      overdueDays: row.overdueDays,
      daysToDue,
      riskLight: row.riskLevel === 'yellow' ? 'amber' : row.riskLevel,
      owner: row.ownerName,
      lastFollowupDate: row.lastFollowupDate,
      lastFollowupNote: row.lastFollowupNote,
      todayAction: !received && daysToDue <= 0,
      isPlaceholder: false,
    }
  })
  const pending = items.filter((item) => item.status === 'pending')
  const sum = (values: string[]) =>
    values.reduce((total, value) => total.plus(value), new Decimal(0)).toFixed(2)
  return {
    asOf,
    items,
    isPlaceholder: false,
    summary: {
      todayCount: items.filter((item) => item.todayAction).length,
      overdueCount: items.filter((item) => item.overdueDays > 0).length,
      overdueAmount: sum(items.filter((item) => item.overdueDays > 0).map((item) => item.expectedAmount)),
      atRiskAmount: sum(items.filter((item) => item.riskLight !== 'green').map((item) => item.expectedAmount)),
      pendingCount: pending.length,
      receivedCount: items.length - pending.length,
      redCount: items.filter((item) => item.riskLight === 'red').length,
      amberCount: items.filter((item) => item.riskLight === 'amber').length,
      greenCount: items.filter((item) => item.riskLight === 'green').length,
      totalCount: items.length,
    },
  }
}

// 仅记一条今日跟进（note 走 body，不走 URL；不改任何金额/状态），返回更新后的该笔
export const repaymentFollowup = (id: string, note: string) =>
  apiPost<{ id: string; receivableId: string; content: string; followedAt: string }>(
    `/api/v1/receivables/${id}/followups`,
    { content: note },
  )

export const listRiskTasks = (status?: RiskTaskStatus) =>
  apiGet<RiskTask[]>('/api/v1/tasks', { status, page: 1, pageSize: 100 })

export const updateRiskTask = (id: string, status: RiskTaskStatus, version: number) =>
  apiPatch<TaskPatchResp>(`/api/v1/tasks/${id}`, { status, version })

// ---- 经营 AI 副驾 ----（自然语言问 → 意图路由调规则引擎 → 人话作答；只读问答，不碰钱）
export const copilotChat = (message: string) =>
  apiPost<CopilotChatResp>('/api/copilot/chat', { message })

// ---- §8.5 参数配置 ----
export const listConfig = () => apiGet<ConfigParam[]>('/api/config')
export const setConfig = (key: string, value: string) =>
  apiPost<ConfigParam>('/api/config', { key, value })

// ---- CEO 驾驶舱 MVP ----
export const cashflowForecast = (asOfDate: string) =>
  apiGet<CashflowForecastResp>('/api/v1/cashflow-forecasts', { asOfDate })

export const receivableRiskTop3 = (asOfDate: string) =>
  apiGet<ReceivableRiskTopResp>('/api/v1/receivable-risks/top3', { asOfDate })

export const paymentRecommendationTop3 = (asOfDate: string) =>
  apiGet<PaymentRecommendationTopResp>('/api/v1/payment-recommendations/top3', { asOfDate })

export const paymentRecommendationExplanation = (id: string) =>
  apiPost<PaymentRecommendationExplanationResp>('/api/v1/payment-recommendations/' + id + '/ai-explanation')

export const listDecisionEvents = (asOfDate: string, status = 'pending') =>
  apiGet<DecisionEvent[]>('/api/v1/decision-events', { asOfDate, status, page: 1, pageSize: 20 })

export const streamDecisionExplanation = (
  eventId: string,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
) => apiSse(`/api/v1/decision-events/${eventId}/ai-explanation:stream`, onEvent, signal)

export { ApiError } from './client'
export type * from './types'
