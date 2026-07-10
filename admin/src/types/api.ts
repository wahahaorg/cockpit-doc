export type BatchStatus = 'uploaded' | 'validating' | 'validation_failed' | 'pending_review' | 'published' | 'voided';
export interface Pagination { page: number; pageSize: number; total: number; totalPages: number }
export interface PageResult<T> { data: T[]; pagination: Pagination; meta?: { requestId: string } }
export interface ObjectResult<T> { data: T; meta?: { requestId: string } }
export interface ImportBatch { id: string; batchNo: string; status: BatchStatus; fileName: string; templateVersion: string; dataPeriodStart?: string; dataPeriodEnd?: string; createdAt: string; version?: number; totalRows?: number; validRows?: number; errorRows?: number; warningRows?: number; publishedAt?: string }
export interface SheetSummary { sheetName: string; totalRows: number; validRows: number; errorRows: number; warningRows: number }
export interface ImportDetail extends ImportBatch { sheets: SheetSummary[]; sheetSummary?: Array<{sheetName:string;validationStatus:string;count:number}>; reviewNote?: string }
export interface ImportRow { id: string; sheetName: string; rowNo: number; validationStatus: 'valid'|'warning'|'error'; rawData: Record<string, unknown>; normalizedData?: Record<string, unknown>; errors?: ValidationError[] }
export interface ValidationError { id?: string; sheetName: string; rowNo: number; field?: string; code: string; message: string; severity: 'warning'|'error' }
export interface AccountBalance { id: string; accountCode: string; accountName: string; availableBalance: string; snapshotDate: string; currency: string }
export interface Customer { id: string; customerCode: string; customerName: string }
export interface Receivable { id: string; receivableNo: string; receivableAmount: string; agreedDueDate: string; ownerCode: string; ownerName: string; sourceStatus: string }
export interface Collection { id: string; collectionNo: string; receivableId: string; collectionAmount: string; collectionDate: string }
export interface PlannedExpense { id: string; expenseNo: string; expenseName: string; plannedAmount: string; plannedDate: string; approvalStatus: string }
export interface Metrics { availableCash: string; expectedCollections: string; actualCollections: string; plannedExpenses: string; cashGap: string; overdueAmount: string; todayTaskCount: number }
export interface Overview { asOfDate: string; batchId: string; ruleVersion: string; reviewStatus: string; metrics: Metrics; warnings: string[] }
export type IncomeReconciliationStatus = 'uploaded' | 'parsing' | 'parsed' | 'parse_failed' | 'generating' | 'generated' | 'generate_failed';
export type IncomeReconciliationFileStatus = 'pending' | 'parsing' | 'success' | 'failed' | 'needs_ocr' | 'warning';
export interface IncomeReconciliationFile {
  fileId: string;
  fileName: string;
  fileType: 'invoice_excel' | 'cashflow_excel' | 'settlement_excel' | 'settlement_pdf' | 'settlement_docx' | 'settlement_file' | string;
  parseStatus: IncomeReconciliationFileStatus;
  parsedRows?: number;
  validRows?: number;
  confidence?: number;
  errorReason?: string | null;
  parseReason?: string | null;
}
export interface IncomeReconciliationSummary {
  confirmedRevenue: number;
  receivedAmount: number;
  unreceivedAmount: number;
  normalCount: number;
  abnormalCount: number;
  invalidInvoiceCount: number;
  manualCheckRequiredCount: number;
}
export interface IncomeReconciliationJob {
  jobId: string;
  status: IncomeReconciliationStatus;
  files?: IncomeReconciliationFile[];
  summary?: IncomeReconciliationSummary | null;
  downloadUrl?: string | null;
  periodStart?: string;
  periodEnd?: string;
}
export interface IncomeReconciliationFileResult {
  fileId: string;
  fileName: string;
  rawText?: string;
  aiExtractedJson?: unknown;
  standardJson?: unknown;
}
