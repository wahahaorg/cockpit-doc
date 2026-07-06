// 后端契约类型（API_DOC.md）。金额字段全部为 string（不可 parseFloat）。

export type Axis = 'income' | 'expense' | 'info'
export type Direction = 'inflow' | 'outflow' | 'neutral'
export type Source = 'rule' | 'llm' | 'manual' | 'llm_failed'
export type Light = 'green' | 'amber' | 'red'

// ---- Layer 2 · 支出审批判断 ----
// 注意：审批灯枚举是四值（含 na），与 Layer 1 的 ga-check 三值 light 不同。
export type ApprovalLight = 'green' | 'amber' | 'red' | 'na'
export type BudgetCategory = 'ga' | 'marketing' | 'claim' | 'procurement' | 'other'

export interface ApprovalCheckReq {
  amount: string // 拟付金额（字符串，不 parseFloat）
  budgetCategory: BudgetCategory
  payee: string
  hasSettlementDoc: boolean
  purpose: string
  month?: string // 缺省取当前月
}

export interface ApprovalRule {
  key: string
  name: string
  light: ApprovalLight
  detail: string
  evidenceSource: string
}

export interface ApprovalCheckResp {
  light: Light // 总灯取最严：green | amber | red
  rules: ApprovalRule[]
  remainingBudget: string | null // null = 不设上限（如 claim）
  budgetCategory: BudgetCategory
  owner: string
  amount: string
  isPlaceholder: boolean
  exceptions: string[]
}

// ---- Layer 2 · 回款风险引擎 ----
// 风险灯三值（无 na；注意是 amber 不是 yellow），与审批卡（含 na）、Layer1 ga-check（yellow）均不同。
export type RepaymentRiskLight = 'green' | 'amber' | 'red'
export type RepaymentStatus = 'pending' | 'received'

export interface RepaymentRiskItem {
  id: string
  customer: string
  summary: string
  expectedAmount: string // 金额字符串，不 parseFloat，用 moneyU
  dueDate: string
  status: RepaymentStatus
  overdueDays: number // 正数=逾期天数；已回/未到期为 0
  daysToDue: number // 正=未到期剩 N 天，0=今天到期，负=已逾期；已回为 0
  riskLight: RepaymentRiskLight
  owner: string
  lastFollowupDate: string | null
  lastFollowupNote: string | null
  todayAction: boolean // 今天要谁处理的核心标志，UI 高亮/置顶
  isPlaceholder: boolean
}

export interface RepaymentRiskSummary {
  todayCount: number
  overdueCount: number
  overdueAmount: string
  atRiskAmount: string
  pendingCount: number
  receivedCount: number
  redCount: number
  amberCount: number
  greenCount: number
  totalCount: number
}

export interface RepaymentRisksResp {
  asOf: string
  summary: RepaymentRiskSummary
  items: RepaymentRiskItem[] // 已按 红→黄→绿、逾期久者在前排好，直接渲染
  isPlaceholder: boolean
}

// ---- V3 标准数据接口 ----
export interface ReceivableRiskRecord {
  receivableId: string
  receivableNo: string
  customerCode: string
  customerName: string
  receivableAmount: string
  collectedAmount: string
  outstandingAmount: string
  agreedDueDate: string
  overdueDays: number
  riskLevel: 'red' | 'yellow' | 'green'
  ownerCode: string
  ownerName: string
  lastFollowupDate: string | null
  lastFollowupNote: string | null
}

export type RiskTaskStatus = 'pending' | 'in_progress' | 'completed' | 'closed'

export interface RiskTask {
  id: string
  title: string
  taskType: string
  riskLevel: 'red' | 'yellow' | 'green'
  ownerCode: string | null
  ownerName: string | null
  dueDate: string
  status: RiskTaskStatus
  bossInterventionRequired: boolean
  version: number
}

export interface TaskPatchResp {
  id: string
  status: RiskTaskStatus
  version: number
}

export interface LoginResp {
  token: string
  expiresInMinutes: number
}

export interface HealthResp {
  status: string
  llmEnabled: boolean
}

export interface ImportResp {
  importBatchId: number
  totalRows: number
  parsedRows: number
  failedRows: number
  failedDetail: { rowIndex: number; reason: string }[]
}

export interface ClassificationRunResp {
  batchId: number
  total: number
  byRule: number
  byLlm: number
  llmFailed: number
  needReview: number
  downgraded: boolean
  failedTxnIds: number[]
}

export interface ClassificationItem {
  id: number
  transactionId: number
  txnDate: string
  amount: string
  direction: Direction
  counterpartyMasked: string
  summary: string
  axis: Axis
  source: Source
  confidence: number | null
  reason: string
  matchedRule: string | null
  expenseCategory: string | null
  needReview: boolean
  isBadCase: boolean
}

export interface ClassificationListResp {
  items: ClassificationItem[]
  total: number
  page: number
  pageSize: number
}

export interface CashGapResp {
  month: string
  plannedOutflow: string
  availableCash: string
  gap: string
  isShortfall: boolean
  traceableTransactionIds: number[]
  isPlaceholder: boolean
}

export interface ForecastPoint {
  month: string
  inflowThisMonth: string
  repaymentThisMonth: string
  outflowThisMonth: string
  netThisMonth: string
  cumulativeCash: string
  traceableTransactionIds: number[]
}

export interface ForecastResp {
  points: ForecastPoint[]
  turnPositiveMonth: string | null
  accountPeriodMonths: number
  traceableTransactionIds: number[]
  isPlaceholder: boolean
}

export interface GAThresholdResp {
  month: string
  revenueBase: string
  gaRatio: string
  monthlyThreshold: string
  used: string
  remaining: string
  greenBand: string
  yellowBand: string
  traceableTransactionIds: number[]
  isPlaceholder: boolean
}

export interface GACheckResp {
  amount: string
  monthlyThreshold: string
  usedBefore: string
  usedAfter: string
  remainingAfter: string
  light: Light
  isPlaceholder: boolean
}

export interface ConfigParam {
  key: string
  value: string
  isPlaceholder: boolean
  note: string | null
  updatedAt: string | null
}

// ---- 经营 AI 副驾 ----（AI 只做意图识别+自然语言表达；数字均来自确定性引擎）
export interface CopilotChatResp {
  answer: string
  intent: string
  light?: 'green' | 'amber' | 'red' | 'na' | null
  card?: Record<string, unknown> | null
  link?: string | null
  source: string
  llmUsed: boolean
  isPlaceholder: boolean
}

// ---- CEO 驾驶舱 MVP ----
export interface CashflowWindow {
  days: 30 | 60 | 90
  minimumBalance: string
  maximumGap: string
  gapDate: string | null
}

export interface CashflowDailyPoint {
  date: string
  expectedInflow: string
  plannedOutflow: string
  netFlow: string
  predictedBalance: string
}

export interface CashflowForecastResp {
  asOfDate: string
  forecastEndDate: string
  batchId: string
  ruleVersion: string
  reviewStatus: string
  openingBalance: string
  safetyLine: string
  windows: CashflowWindow[]
  firstBreachDate: string | null
  recoveryDate: string | null
  overdueUnconfirmedAmount: string
  daily: CashflowDailyPoint[]
  warnings: string[]
}

export interface ReceivableRiskTopItem extends ReceivableRiskRecord {
  daysToDue: number
  dueStatus: 'overdue' | 'due_today' | 'due_soon' | 'normal'
  dueText: string
  reasonCodes: string[]
}

export interface ReceivableRiskTopResp {
  asOfDate: string
  batchId: string
  candidateCount: number
  redCount: number
  yellowCount: number
  items: ReceivableRiskTopItem[]
}

export type PaymentDecision = 'boss_review' | 'defer' | 'needs_evidence' | 'not_ready' | 'pay'

export interface PaymentRecommendation {
  id: string
  plannedExpenseId: string
  expenseNo: string
  expenseName: string
  plannedDate: string
  plannedAmount: string
  rigidity: string
  approvalStatus: string
  ownerCode: string | null
  ownerName: string | null
  queueOrder: number | null
  eligibilityResult: string
  decision: PaymentDecision
  reasonCodes: string[]
  gapBefore: string | null
  gapAfter: string | null
  gapIncrease: string | null
  gapDate: string | null
  recoveryDate: string | null
  evidence: Record<string, unknown>
  aiExplanation: string | null
}

export interface PaymentRecommendationTopResp {
  asOfDate: string
  batchId: string
  items: PaymentRecommendation[]
}

export interface PaymentRecommendationExplanationResp {
  id: string
  aiExplanation: string
  cached: boolean
  item: PaymentRecommendation
}

export interface DecisionEvent {
  id: string
  eventType: 'receivable_risk' | 'payment_assessment'
  title: string
  riskLevel: 'red' | 'yellow' | 'green'
  impactAmount: string
  impactDate: string | null
  ownerCode: string | null
  ownerName: string | null
  reasonCodes: string[]
  evidence: Record<string, unknown>
  allowedOptions: string[]
  status: 'pending' | 'decided' | 'closed'
  selectedOption: string | null
  decisionNote: string | null
  version: number
  batchId: string
  ruleVersion: string
}
