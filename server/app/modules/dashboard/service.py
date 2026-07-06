from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.modules.cashflow.calculators import ReceivableFact, cash_gap, month_bounds
from app.modules.cashflow.models import AccountBalance, Collection, Customer, FollowupRecord, PlannedExpense, Receivable, Task
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
    facts = receivable_facts(db, batch.id)
    receivable_ids = [rec.id for rec, _, _ in facts]
    followups = db.scalars(
        select(FollowupRecord)
        .where(FollowupRecord.receivable_id.in_(receivable_ids))
        .order_by(FollowupRecord.followed_at.desc())
    ).all() if receivable_ids else []
    latest_followup = {}
    for followup in followups:
        latest_followup.setdefault(followup.receivable_id, followup)
    items = []
    for rec, customer, fact in facts:
        level = fact.risk_level(as_of)
        if risk_level and level != risk_level or owner_code and rec.owner_code != owner_code:
            continue
        followup = latest_followup.get(rec.id)
        days_to_due = (rec.agreed_due_date - as_of).days
        if days_to_due < 0:
            due_status, due_text = "overdue", f"逾期 {abs(days_to_due)} 天"
        elif days_to_due == 0:
            due_status, due_text = "due_today", "今日到期"
        elif days_to_due <= 2:
            due_status, due_text = "due_soon", "明日到期" if days_to_due == 1 else "还有 2 天到期"
        else:
            due_status, due_text = "normal", f"距到期 {days_to_due} 天"
        reasons = []
        if fact.overdue_days(as_of) >= 30: reasons.append("overdue_30_days")
        if fact.overdue_days(as_of) > 0 and fact.outstanding >= Decimal("1000000"): reasons.append("overdue_large_amount")
        if level == "yellow" and fact.overdue_days(as_of) > 0: reasons.append("overdue_under_30_days")
        if level == "yellow" and 0 <= days_to_due <= 2: reasons.append("due_within_2_days")
        items.append({"receivableId": str(rec.id), "receivableNo": rec.receivable_no, "customerCode": customer.customer_code, "customerName": customer.customer_name, "receivableAmount": _money(Decimal(rec.receivable_amount)), "collectedAmount": _money(fact.collected), "outstandingAmount": _money(fact.outstanding), "agreedDueDate": rec.agreed_due_date.isoformat(), "overdueDays": fact.overdue_days(as_of), "daysToDue": days_to_due, "dueStatus": due_status, "dueText": due_text, "riskLevel": level, "reasonCodes": reasons, "ownerCode": rec.owner_code, "ownerName": rec.owner_name, "lastFollowupDate": followup.followed_at.date().isoformat() if followup else None, "lastFollowupNote": followup.content if followup else None})
    order = {"red": 0, "yellow": 1, "green": 2}
    return sorted(items, key=lambda x: (order[x["riskLevel"]], x["daysToDue"], -x["overdueDays"], -Decimal(x["outstandingAmount"]), x["receivableNo"]))


def simulate_expense(db: Session, as_of: date, amount: Decimal) -> dict:
    base = overview(db, as_of)
    available = Decimal(base["metrics"]["availableCash"])
    gap_before = Decimal(base["metrics"]["cashGap"])
    projected = available - amount
    gap_after = gap_before + amount
    return {"asOfDate": as_of.isoformat(), "amount": _money(amount), "cashBefore": _money(available), "cashAfter": _money(projected), "cashGapBefore": _money(gap_before), "cashGapAfter": _money(gap_after), "riskLevel": "red" if gap_after > 0 else "green", "ruleVersion": get_settings().rule_version, "warnings": ["试算结果待 CFO 确认，不构成付款指令"]}
