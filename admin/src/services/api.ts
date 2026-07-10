import type { AccountBalance, Collection, ImportBatch, ImportDetail, ImportRow, IncomeReconciliationFileResult, IncomeReconciliationJob, ObjectResult, Overview, PageResult, PlannedExpense, Receivable, ValidationError } from '@/types/api';
import * as mock from './mock'; import { apiUrl, request } from './http';
const page = <T>(data: T[]): PageResult<T> => ({ data, pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 } });
const generateUUID = (): string => { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }); };
export const api = {
  imports: () => request<PageResult<ImportBatch>>('/imports?page=1&pageSize=20', undefined, () => page(mock.batches)),
  importDetail: (id: string) => request<ObjectResult<ImportDetail>>(`/imports/${id}`, undefined, () => ({ data: { ...mock.detail, id } })),
  importRows: (id: string) => request<PageResult<ImportRow>>(`/imports/${id}/rows?page=1&pageSize=20`, undefined, () => page(mock.rows)),
  validationErrors: (id: string) => request<PageResult<ValidationError>>(`/imports/${id}/validation-errors?page=1&pageSize=20`, undefined, () => page(mock.errors)),
  upload: (file: File) => { const data = new FormData(); const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth() - 2, 1); const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); const iso = (value: Date) => value.toISOString().slice(0, 10); data.append('file', file); data.append('templateVersion', 'V0.1'); data.append('dataPeriodStart', iso(start)); data.append('dataPeriodEnd', iso(end)); return request<ObjectResult<ImportBatch>>('/imports', { method: 'POST', body: data }); },
  publish: (batch: ImportBatch) => request<ObjectResult<ImportBatch>>(`/imports/${batch.id}:publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': generateUUID() }, body: JSON.stringify({ version: batch.version || 1, reviewNote: '已完成样本核对' }) }),
  accounts: () => request<PageResult<AccountBalance>>('/account-balances?page=1&pageSize=20', undefined, () => page(mock.accounts)),
  receivables: () => request<PageResult<Receivable>>('/receivables?page=1&pageSize=20', undefined, () => page(mock.receivables)),
  collections: () => request<PageResult<Collection>>('/collections?page=1&pageSize=20', undefined, () => page(mock.collections)),
  expenses: () => request<PageResult<PlannedExpense>>('/planned-expenses?page=1&pageSize=20', undefined, () => page(mock.expenses)),
  overview: () => request<ObjectResult<Overview>>('/cockpit/overview', undefined, () => ({ data: mock.overview })),
  createIncomeReconciliationJob: (payload: { invoiceFile: File; cashflowFile: File; settlementFiles: File[] }) => { const data = new FormData(); data.append('invoice_file', payload.invoiceFile); data.append('cashflow_file', payload.cashflowFile); payload.settlementFiles.forEach((file) => data.append('settlement_files[]', file)); return request<ObjectResult<IncomeReconciliationJob>>('/income-reconciliation/jobs', { method: 'POST', body: data }, () => ({ data: { ...mock.incomeJob, status: 'uploaded', files: payload.settlementFiles.length ? mock.incomeJob.files : [] } })); },
  incomeReconciliationJob: (jobId: string) => request<ObjectResult<IncomeReconciliationJob>>(`/income-reconciliation/jobs/${jobId}`, undefined, () => ({ data: { ...mock.incomeJob, jobId } })),
  parseIncomeReconciliationJob: (jobId: string) => request<ObjectResult<IncomeReconciliationJob>>(`/income-reconciliation/jobs/${jobId}/parse`, { method: 'POST' }, () => ({ data: { ...mock.incomeJob, jobId, status: 'parsed' } })),
  generateIncomeReconciliationExcel: (jobId: string) => request<ObjectResult<IncomeReconciliationJob>>(`/income-reconciliation/jobs/${jobId}/generate`, { method: 'POST' }, () => ({ data: { ...mock.incomeJob, jobId, status: 'generated' } })),
  incomeReconciliationFileResult: (jobId: string, fileId: string) => request<ObjectResult<IncomeReconciliationFileResult>>(`/income-reconciliation/jobs/${jobId}/files/${fileId}`, undefined, () => ({ data: mock.incomeFileResult(fileId) })),
  incomeReconciliationDownloadUrl: (jobId: string) => apiUrl(`/income-reconciliation/jobs/${jobId}/download`),
};
