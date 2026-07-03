from datetime import date
from io import BytesIO
from pathlib import Path

from openpyxl import Workbook

from app.modules.data_import.parsers import SHEETS, parse_workbook


def workbook_bytes(invalid_reference: bool = False) -> bytes:
    wb = Workbook(); wb.remove(wb.active)
    data = {
        "账户余额": ["A-01", "基本户", date(2026, 7, 2), 3000000, "CNY", 0, ""],
        "应收款": ["AR-001", "C-001", "客户甲", "B-1", 1200000, date(2026, 5, 12), date(2026, 7, 5), "U-1", "销售A", "团险", "open", ""],
        "实际回款": ["COL-001", "AR-X" if invalid_reference else "AR-001", date(2026, 7, 1), 200000, "CNY", "BR-1", ""],
        "计划支出": ["EXP-001", "工资", "人力", date(2026, 7, 10), 3500000, "U-2", "财务B", "rigid", "approved", ""],
    }
    for name, fields in SHEETS.items():
        ws = wb.create_sheet(name); ws.append([v[0] for v in fields.values()]); ws.append(data[name])
    out = BytesIO(); wb.save(out); return out.getvalue()


def test_parse_fixed_template():
    rows = parse_workbook(workbook_bytes())
    assert len(rows) == 4
    assert all(row.status == "valid" for row in rows)
    assert rows[0].normalized_data["available_balance"].as_tuple().exponent == -2


def test_missing_receivable_reference_is_blocking_error():
    rows = parse_workbook(workbook_bytes(invalid_reference=True))
    collection = next(r for r in rows if r.sheet_name == "实际回款")
    assert collection.status == "error"
    assert collection.messages[0]["code"] == "reference_not_found"


def test_parse_delivered_v01_template():
    template = Path(__file__).parents[3] / "output" / "CEO现金流驾驶舱_V3_财务样本数据模板_V0.1.xlsx"
    rows = parse_workbook(template.read_bytes())

    assert len(rows) == 11
    assert all(row.status == "valid" for row in rows)
    assert {row.row_no for row in rows if row.sheet_name == "账户余额"} == {5, 6}
