import type { AccountBalance, Collection, ImportBatch, ImportDetail, ImportRow, Overview, PlannedExpense, Receivable, ValidationError } from '@/types/api';
export const batches: ImportBatch[] = [
  { id:'demo-1', batchNo:'IMP-20260702-001', status:'pending_review', fileName:'财务脱敏样本_2026Q2.xlsx', templateVersion:'V0.1', dataPeriodStart:'2026-04-01', dataPeriodEnd:'2026-06-30', createdAt:'2026-07-02T10:00:00+08:00', version:3, totalRows:86, validRows:82, errorRows:2, warningRows:2 },
  { id:'demo-0', batchNo:'IMP-20260620-001', status:'published', fileName:'财务脱敏样本_202605.xlsx', templateVersion:'V0.1', createdAt:'2026-06-20T09:00:00+08:00', totalRows:52, validRows:52, errorRows:0, warningRows:0 },
];
export const detail: ImportDetail = { ...batches[0]!, sheets:[{sheetName:'账户余额',totalRows:4,validRows:4,errorRows:0,warningRows:0},{sheetName:'应收款',totalRows:30,validRows:27,errorRows:2,warningRows:1},{sheetName:'实际回款',totalRows:24,validRows:24,errorRows:0,warningRows:0},{sheetName:'计划支出',totalRows:28,validRows:27,errorRows:0,warningRows:1}] };
export const errors: ValidationError[] = [{sheetName:'应收款',rowNo:12,field:'due_date',code:'invalid_date',message:'约定到账日期格式错误',severity:'error'},{sheetName:'应收款',rowNo:19,field:'receivable_no',code:'duplicate_value',message:'应收编号重复',severity:'error'}];
export const rows: ImportRow[] = errors.map((e,i)=>({id:`row-${i}`,sheetName:e.sheetName,rowNo:e.rowNo,validationStatus:'error',rawData:{客户名称:'脱敏客户',应收金额:'700000',约定到账日:i?'2026-06-06':'六月六日'},errors:[e]}));
export const accounts: AccountBalance[]=[{id:'a1',accountCode:'ACC-001',accountName:'基本账户',availableBalance:'3000000.00',snapshotDate:'2026-07-02',currency:'CNY'}];
export const receivables: Receivable[]=[{id:'r1',receivableNo:'AR-001',receivableAmount:'1200000.00',agreedDueDate:'2026-05-12',ownerCode:'U-001',ownerName:'客户经理',sourceStatus:'open'}];
export const collections: Collection[]=[{id:'c1',collectionNo:'COL-001',receivableId:'r1',collectionAmount:'700000.00',collectionDate:'2026-07-01'}];
export const expenses: PlannedExpense[]=[{id:'e1',expenseNo:'EXP-001',expenseName:'本月运营支出',plannedAmount:'10500000.00',plannedDate:'2026-07-25',approvalStatus:'approved'}];
export const overview: Overview={asOfDate:'2026-07-02',batchId:'demo-1',ruleVersion:'cashflow-rules-v0.1',reviewStatus:'pending_cfo_review',metrics:{availableCash:'3000000.00',expectedCollections:'1500000.00',actualCollections:'700000.00',plannedExpenses:'10500000.00',cashGap:'6000000.00',overdueAmount:'1900000.00',todayTaskCount:4},warnings:['脱敏样本 · 待 CFO 复核 · 不作为正式经营结论']};
