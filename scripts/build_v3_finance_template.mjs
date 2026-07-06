import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "/Users/xsz/project/cockpit/output";
await fs.mkdir(outputDir, { recursive: true });

const wb = Workbook.create();
const guide = wb.worksheets.add("填写说明");
const balances = wb.worksheets.add("账户余额");
const receivables = wb.worksheets.add("应收款");
const collections = wb.worksheets.add("实际回款");
const expenses = wb.worksheets.add("计划支出");
const checks = wb.worksheets.add("校验清单");

const colors = {
  navy: "#123047",
  teal: "#16879A",
  cyan: "#DFF5F7",
  pale: "#F4F8FA",
  line: "#D7E2E8",
  warning: "#FFF3D6",
  danger: "#FDE8EA",
  white: "#FFFFFF",
  text: "#1F2937",
};

function title(sheet, text, subtitle, endCol) {
  sheet.showGridLines = false;
  sheet.getRange(`A1:${endCol}1`).merge();
  sheet.getRange("A1").values = [[text]];
  sheet.getRange(`A1:${endCol}1`).format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white, size: 16 },
    rowHeight: 34,
    verticalAlignment: "center",
  };
  sheet.getRange(`A2:${endCol}2`).merge();
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A2:${endCol}2`).format = {
    fill: colors.cyan,
    font: { color: colors.text, italic: true },
    wrapText: true,
    rowHeight: 32,
    verticalAlignment: "center",
  };
}

function setupInputSheet(sheet, sheetTitle, subtitle, headers, rows, endCol, widths) {
  title(sheet, sheetTitle, subtitle, endCol);
  sheet.getRange(`A4:${endCol}4`).values = [headers];
  sheet.getRange(`A4:${endCol}4`).format = {
    fill: colors.teal,
    font: { bold: true, color: colors.white },
    wrapText: true,
    rowHeight: 36,
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: colors.line },
  };
  if (rows.length) {
    const range = sheet.getRangeByIndexes(4, 0, rows.length, headers.length);
    range.values = rows;
    range.format = {
      fill: colors.white,
      font: { color: colors.text },
      borders: { insideHorizontal: { style: "thin", color: colors.line } },
      verticalAlignment: "center",
      wrapText: true,
    };
  }
  sheet.freezePanes.freezeRows(4);
  headers.forEach((_, i) => {
    sheet.getRangeByIndexes(0, i, Math.max(rows.length + 4, 5), 1).format.columnWidth = widths[i];
  });
}

title(guide, "CEO 现金流驾驶舱 V3 财务样本数据模板", "版本 V0.1｜脱敏样本｜待 CFO 复核｜不作为正式经营结论", "F");
guide.getRange("A4:F4").values = [["项目", "说明", "是否必读", "负责人", "确认状态", "备注"]];
guide.getRange("A4:F4").format = { fill: colors.teal, font: { bold: true, color: colors.white }, rowHeight: 28 };
guide.getRange("A5:F13").values = [
  ["填写范围", "仅填写账户余额、应收款、实际回款、计划支出四类原始事实。", "是", "财务", "待确认", "不要填写逾期天数、风险等级、现金缺口。"],
  ["数据期间", "建议提供连续 1-3 个自然月的脱敏样本。", "是", "财务", "待确认", "模板中的示例行可删除。"],
  ["金额单位", "统一使用人民币元，填写数值，不输入“万元”或货币符号。", "是", "财务/CFO", "待确认", "金额最多两位小数。"],
  ["日期格式", "统一使用 YYYY-MM-DD。", "是", "财务", "待确认", "例如 2026-07-02。"],
  ["唯一编号", "账户、应收、回款、支出编号必须稳定且不可重复。", "是", "财务/产品", "待确认", "编号用于增量识别和关联。"],
  ["应收与回款", "实际回款通过“应收编号”关联到应收款，允许一笔应收分多次回款。", "是", "财务/CFO", "待确认", "V0.1 暂不支持一笔回款分摊多笔应收。"],
  ["责任人", "应收和计划支出必须提供责任人编号与名称。", "是", "业务/财务", "待确认", "用于生成“谁在处理”。"],
  ["空值语义", "必填字段不得为空；可选字段为空表示未提供，不代表清空历史值。", "是", "产品/技术", "待确认", "正式更新规则在真实样本后冻结。"],
  ["数据声明", "所有样本必须脱敏；当前计算结果待 CFO 复核。", "是", "全部", "待确认", "不得作为正式经营结论。"],
];
guide.getRange("A5:F13").format = { borders: { insideHorizontal: { style: "thin", color: colors.line } }, wrapText: true, verticalAlignment: "top" };
guide.getRange("A1:F13").format.font = { name: "Aptos", color: colors.text };
guide.getRange("A1:F1").format.font = { name: "Aptos Display", bold: true, color: colors.white, size: 16 };
guide.getRange("A:A").format.columnWidth = 18;
guide.getRange("B:B").format.columnWidth = 48;
guide.getRange("C:F").format.columnWidth = 18;
guide.getRange("F:F").format.columnWidth = 40;
guide.getRange("A5:F13").format.rowHeight = 42;
guide.freezePanes.freezeRows(4);

setupInputSheet(
  balances,
  "账户余额",
  "一行代表一个账户在某一天的余额快照；同一账户同一天只能有一行。",
  ["账户编号*", "账户名称*", "快照日期*", "可用余额（元）*", "币种*", "受限金额（元）", "备注"],
  [
    ["ACC-001", "基本户（脱敏）", new Date("2026-07-02"), 1800000, "CNY", 0, "示例数据"],
    ["ACC-002", "一般户（脱敏）", new Date("2026-07-02"), 1200000, "CNY", 0, "示例数据"],
  ],
  "G",
  [16, 24, 16, 20, 12, 20, 32],
);
balances.getRange("C5:C200").format.numberFormat = "yyyy-mm-dd";
balances.getRange("D5:F200").format.numberFormat = "#,##0.00;[Red](#,##0.00);-";
balances.getRange("E5:E200").dataValidation = { rule: { type: "list", values: ["CNY"] } };

setupInputSheet(
  receivables,
  "应收款",
  "一行代表一笔独立应收事项；只填原始应收事实，不填未回金额、逾期天数或风险等级。",
  ["应收编号*", "客户编号*", "客户名称*", "合同/业务编号", "应收金额（元）*", "约定到账日期*", "预计到账日期", "责任人编号*", "责任人名称*", "业务线", "业务状态*", "客户等级", "备注"],
  [
    ["AR-2026-001", "CUS-001", "某大型团险客户", "BIZ-001", 1200000, new Date("2026-05-12"), new Date("2026-07-05"), "U-001", "客户经理A", "团险", "open", "key", "逾期且未回示例"],
    ["AR-2026-002", "CUS-002", "某保险经纪", "BIZ-002", 700000, new Date("2026-06-06"), new Date("2026-07-08"), "U-002", "销售A", "保费", "open", "normal", "部分回款示例"],
    ["AR-2026-003", "CUS-003", "某团险客户", "BIZ-003", 520000, new Date("2026-06-14"), new Date("2026-07-10"), "U-003", "客户经理B", "团险", "open", "normal", "逾期示例"],
    ["AR-2026-004", "CUS-004", "某企业客户", "BIZ-004", 900000, new Date("2026-07-20"), new Date("2026-07-20"), "U-004", "销售B", "企业服务", "open", "normal", "未到期示例"],
  ],
  "M",
  [18, 16, 24, 18, 20, 18, 18, 18, 18, 16, 16, 16, 30],
);
receivables.getRange("E5:E200").format.numberFormat = "#,##0.00;[Red](#,##0.00);-";
receivables.getRange("F5:G200").format.numberFormat = "yyyy-mm-dd";
receivables.getRange("K5:K200").dataValidation = { rule: { type: "list", values: ["open", "cancelled"] } };
receivables.getRange("L5:L200").dataValidation = { rule: { type: "list", values: ["normal", "key"] } };

setupInputSheet(
  collections,
  "实际回款",
  "一行代表一次实际到账事件；同一应收可有多笔回款，累计金额原则上不得超过应收金额。",
  ["回款编号*", "应收编号*", "回款日期*", "回款金额（元）*", "币种*", "银行流水参考号", "备注"],
  [
    ["COL-2026-001", "AR-2026-002", new Date("2026-07-01"), 200000, "CNY", "BANK-***001", "部分回款示例"],
    ["COL-2026-002", "AR-2026-004", new Date("2026-07-02"), 500000, "CNY", "BANK-***002", "本月实际回款示例"],
  ],
  "G",
  [20, 18, 18, 20, 12, 24, 34],
);
collections.getRange("C5:C200").format.numberFormat = "yyyy-mm-dd";
collections.getRange("D5:D200").format.numberFormat = "#,##0.00;[Red](#,##0.00);-";
collections.getRange("E5:E200").dataValidation = { rule: { type: "list", values: ["CNY"] } };

setupInputSheet(
  expenses,
  "计划支出",
  "一行代表一笔计划支出；取消状态不参与本月计划支出计算。",
  ["支出计划编号*", "支出名称*", "支出类别*", "计划支出日期*", "计划金额（元）*", "责任人编号*", "责任人名称*", "刚性程度*", "审批状态*", "备注"],
  [
    ["EXP-2026-001", "员工薪酬", "人力成本", new Date("2026-07-10"), 2400000, "U-FIN-001", "财务负责人", "rigid", "approved", "刚性支出示例"],
    ["EXP-2026-002", "供应商服务费", "运营支出", new Date("2026-07-15"), 1800000, "U-OPS-001", "运营负责人", "deferrable", "pending", "可延后示例"],
    ["EXP-2026-003", "税费", "税费", new Date("2026-07-20"), 900000, "U-FIN-001", "财务负责人", "rigid", "planned", "计划支出示例"],
  ],
  "J",
  [20, 24, 18, 18, 20, 18, 18, 16, 16, 34],
);
expenses.getRange("D5:D200").format.numberFormat = "yyyy-mm-dd";
expenses.getRange("E5:E200").format.numberFormat = "#,##0.00;[Red](#,##0.00);-";
expenses.getRange("H5:H200").dataValidation = { rule: { type: "list", values: ["rigid", "deferrable"] } };
expenses.getRange("I5:I200").dataValidation = { rule: { type: "list", values: ["planned", "pending", "approved", "cancelled"] } };

title(checks, "导入校验清单", "用于产品、财务和研发共同确认。严重级别为“错误”的项目必须修正后才能发布。", "F");
checks.getRange("A4:F4").values = [["数据类型", "校验项", "严重级别", "错误码", "处理建议", "CFO/产品确认"]];
checks.getRange("A4:F4").format = { fill: colors.teal, font: { bold: true, color: colors.white }, rowHeight: 30 };
checks.getRange("A5:F17").values = [
  ["全部", "必填字段不得为空", "错误", "required_field_missing", "补全必填字段", "待确认"],
  ["全部", "日期必须是有效 YYYY-MM-DD", "错误", "invalid_date", "修正日期", "待确认"],
  ["全部", "金额必须为数值且大于 0（余额可为 0）", "错误", "invalid_amount", "修正金额", "待确认"],
  ["全部", "币种 V0.1 仅支持 CNY", "错误", "unsupported_currency", "转换为人民币或暂缓导入", "待确认"],
  ["账户余额", "同账户同快照日期不可重复", "错误", "duplicate_balance_snapshot", "合并或删除重复行", "待确认"],
  ["应收款", "应收编号不可重复", "错误", "duplicate_receivable_no", "确认唯一编号", "待确认"],
  ["应收款", "必须存在责任人编号和名称", "错误", "owner_missing", "补充责任人", "待确认"],
  ["实际回款", "应收编号必须存在", "错误", "receivable_not_found", "补充应收或修正编号", "待确认"],
  ["实际回款", "回款编号不可重复", "错误", "duplicate_collection_no", "修正重复流水", "待确认"],
  ["实际回款", "累计回款不得超过应收金额", "错误", "collection_exceeds_receivable", "确认溢收/退款/冲销口径", "待确认"],
  ["计划支出", "支出计划编号不可重复", "错误", "duplicate_expense_no", "确认唯一编号", "待确认"],
  ["计划支出", "刚性程度和审批状态必须在枚举内", "错误", "invalid_enum", "使用模板下拉值", "待确认"],
  ["全部", "数据超出申报的数据期间", "警告", "outside_data_period", "确认是否包含历史补录", "待确认"],
];
checks.getRange("A5:F17").format = { borders: { insideHorizontal: { style: "thin", color: colors.line } }, wrapText: true, verticalAlignment: "top", rowHeight: 34 };
checks.getRange("A:A").format.columnWidth = 18;
checks.getRange("B:B").format.columnWidth = 44;
checks.getRange("C:D").format.columnWidth = 22;
checks.getRange("E:F").format.columnWidth = 38;
checks.getRange("C5:C17").conditionalFormats.add("containsText", { text: "错误", format: { fill: colors.danger, font: { color: "#B42335", bold: true } } });
checks.getRange("C5:C17").conditionalFormats.add("containsText", { text: "警告", format: { fill: colors.warning, font: { color: "#A15C00", bold: true } } });
checks.freezePanes.freezeRows(4);

for (const sheet of [balances, receivables, collections, expenses]) {
  sheet.getUsedRange().format.font = { name: "Aptos", color: colors.text };
  sheet.getRange("A1:Z1").format.font = { name: "Aptos Display", bold: true, color: colors.white, size: 16 };
}

const inspect = await wb.inspect({ kind: "sheet", include: "id,name", maxChars: 4000 });
console.log(inspect.ndjson);

for (const sheetName of ["填写说明", "账户余额", "应收款", "实际回款", "计划支出", "校验清单"]) {
  const preview = await wb.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/preview_${sheetName}.png`, new Uint8Array(await preview.arrayBuffer()));
}

const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(`${outputDir}/CEO现金流驾驶舱_V3_财务样本数据模板_V0.1.xlsx`);

