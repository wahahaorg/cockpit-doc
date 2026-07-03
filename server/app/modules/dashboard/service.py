from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.modules.cashflow.calculators import ReceivableFact, cash_gap, month_bounds
from app.modules.cashflow.models import AccountBalance, Collection, Customer, PlannedExpense, Receivable, Task
from app.modules.data_import.service import current_batch


def _money(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01')):.2f}"


def receivable_facts(db: Session, batch_id: UUID) -> list[tuple[Receivable, Customer, ReceivableFact]]:
    collected = select(Collection.receivable_id, func.coalesce(func.sum(Collection.collection_amount), 0).label("total")).where(Collection.import_batch_id == batch_id, Collection.status == "active").group_by(Collection.receivable_id).subquery()
    rows = db.execute(select(Receivable, Customer, func.coalesce(collected.c.total, 0)).join(Customer, Customer.id == Receivable.customer_id).outerjoin(collected, collected.c.receivable_id == Receivable.id).where(Receivable.import_batch_id == batch_id, Receivable.source_status == "open", Receivable.status == "active")).all()
    return [(r, c, ReceivableFact(r.id, Decimal(r.receivable_amount), r.agreed_due_date, r.expected_date, Decimal(total))) for r, c, total in rows]


def overview(db: Session, as_of: date, batch_id: UUID | None = None) -> dict:
    batch = current_batch(db, batch_id)
    start, end = month_bounds(as_of)
    latest_dates = select(AccountBalance.account_code, func.max(AccountBalance.snapshot_date).label("latest")).where(AccountBalance.import_batch_id == batch.id, AccountBalance.snapshot_date <= as_of, AccountBalance.status == "active").group_by(AccountBalance.account_code).subquery()
    available = Decimal(db.scalar(select(func.coalesce(func.sum(AccountBalance.available_balance), 0)).join(latest_dates, (AccountBalance.account_code == latest_dates.c.account_code) & (AccountBalance.snapshot_date == latest_dates.c.latest)).where(AccountBalance.import_batch_id == batch.id)) or 0)
    facts = receivable_facts(db, batch.id)
    expected = sum((f.outstanding for _, _, f in facts if start <= (f.expected_date or f.due_date) <= end), Decimal("0"))
    actual = Decimal(db.scalar(select(func.coalesce(func.sum(Collection.collection_amount), 0)).where(Collection.import_batch_id == batch.id, Collection.collection_date.between(start, end), Collection.status == "active")) or 0)
    planned = Decimal(db.scalar(select(func.coalesce(func.sum(PlannedExpense.planned_amount), 0)).where(PlannedExpense.import_batch_id == batch.id, PlannedExpense.planned_date.between(start, end), PlannedExpense.approval_status.in_(["planned", "pending", "approved"]), PlannedExpense.status == "active")) or 0)
    expected_remaining = sum((f.outstanding for _, _, f in facts if as_of <= (f.expected_date or f.due_date) <= end), Decimal("0"))
    planned_remaining = Decimal(db.scalar(select(func.coalesce(func.sum(PlannedExpense.planned_amount), 0)).where(PlannedExpense.import_batch_id == batch.id, PlannedExpense.planned_date.between(as_of, end), PlannedExpense.approval_status.in_(["planned", "pending", "approved"]), PlannedExpense.status == "active")) or 0)
    gap = cash_gap(available, expected_remaining, planned_remaining)
    overdue = sum((f.outstanding for _, _, f in facts if f.overdue_days(as_of) > 0), Decimal("0"))
    task_count = db.scalar(select(func.count()).select_from(Task).where(Task.import_batch_id == batch.id, Task.due_date <= as_of, Task.status.in_(["pending", "in_progress"]))) or 0
    red_risks = [f for _, _, f in facts if f.risk_level(as_of) == "red"]
    cards = [
        {"code": "cash_sufficiency", "level": "red" if gap > 0 else "green", "title": "钱够不够", "summary": "本月存在现金流缺口" if gap > 0 else "本月现金预计可覆盖计划支出", "bossInterventionRequired": gap > 0},
        {"code": "collection_status", "level": "red" if red_risks else ("yellow" if overdue > 0 else "green"), "title": "钱该进没进", "summary": f"逾期未回 {_money(overdue)} 元" if overdue else "暂无逾期未回", "bossInterventionRequired": bool(red_risks)},
        {"code": "spending_capacity", "level": "red" if gap > 0 else "green", "title": "钱能不能花", "summary": "新增支出前建议先试算" if gap > 0 else "当前预测现金可覆盖计划", "bossInterventionRequired": gap > 0},
        {"code": "ownership", "level": "yellow" if task_count else "green", "title": "谁在处理", "summary": f"今日 {task_count} 项待处理", "bossInterventionRequired": any(t for t in red_risks)},
    ]
    return {"asOfDate": as_of.isoformat(), "periodStart": start.isoformat(), "periodEnd": end.isoformat(), "batchId": str(batch.id), "ruleVersion": get_settings().rule_version, "reviewStatus": get_settings().review_status, "metrics": {"availableCash": _money(available), "expectedCollections": _money(expected), "actualCollections": _money(actual), "plannedExpenses": _money(planned), "cashGap": _money(gap), "overdueAmount": _money(overdue), "todayTaskCount": task_count}, "cards": cards, "warnings": ["当前规则待 CFO 确认，不作为正式经营结论"]}


def risks(db: Session, as_of: date, risk_level: str | None = None, owner_code: str | None = None) -> list[dict]:
    batch = current_batch(db)
    items = []
    for rec, customer, fact in receivable_facts(db, batch.id):
        level = fact.risk_level(as_of)
        if risk_level and level != risk_level or owner_code and rec.owner_code != owner_code:
            continue
        items.append({"receivableId": str(rec.id), "receivableNo": rec.receivable_no, "customerCode": customer.customer_code, "customerName": customer.customer_name, "receivableAmount": _money(Decimal(rec.receivable_amount)), "collectedAmount": _money(fact.collected), "outstandingAmount": _money(fact.outstanding), "agreedDueDate": rec.agreed_due_date.isoformat(), "overdueDays": fact.overdue_days(as_of), "riskLevel": level, "ownerCode": rec.owner_code, "ownerName": rec.owner_name})
    order = {"red": 0, "yellow": 1, "green": 2}
    return sorted(items, key=lambda x: (order[x["riskLevel"]], -x["overdueDays"], -Decimal(x["outstandingAmount"])))


def simulate_expense(db: Session, as_of: date, amount: Decimal) -> dict:
    base = overview(db, as_of)
    available = Decimal(base["metrics"]["availableCash"])
    gap_before = Decimal(base["metrics"]["cashGap"])
    projected = available - amount
    gap_after = gap_before + amount
    return {"asOfDate": as_of.isoformat(), "amount": _money(amount), "cashBefore": _money(available), "cashAfter": _money(projected), "cashGapBefore": _money(gap_before), "cashGapAfter": _money(gap_after), "riskLevel": "red" if gap_after > 0 else "green", "ruleVersion": get_settings().rule_version, "warnings": ["试算结果待 CFO 确认，不构成付款指令"]}

