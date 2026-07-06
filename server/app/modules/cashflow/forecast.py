from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.modules.cashflow.calculators import CashflowEntry, build_daily_forecast, curve_summary
from app.modules.cashflow.models import AccountBalance, PlannedExpense
from app.modules.dashboard.service import receivable_facts
from app.modules.data_import.models import ImportBatch
from app.modules.data_import.service import current_batch


ZERO = Decimal("0.00")


def money(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01')):.2f}"


def forecast_inputs(db: Session, as_of: date, batch: ImportBatch) -> tuple[Decimal, list[CashflowEntry], list[CashflowEntry], list[str], Decimal]:
    warnings: list[str] = []
    account_codes = db.scalars(
        select(AccountBalance.account_code).where(AccountBalance.import_batch_id == batch.id, AccountBalance.status == "active").distinct()
    ).all()
    latest_dates = select(
        AccountBalance.account_code,
        func.max(AccountBalance.snapshot_date).label("latest"),
    ).where(
        AccountBalance.import_batch_id == batch.id,
        AccountBalance.snapshot_date <= as_of,
        AccountBalance.status == "active",
    ).group_by(AccountBalance.account_code).subquery()
    balances = db.execute(
        select(AccountBalance.account_code, AccountBalance.available_balance)
        .join(latest_dates, (AccountBalance.account_code == latest_dates.c.account_code) & (AccountBalance.snapshot_date == latest_dates.c.latest))
        .where(AccountBalance.import_batch_id == batch.id, AccountBalance.status == "active")
    ).all()
    opening_balance = sum((Decimal(amount) for _, amount in balances), ZERO)
    missing_accounts = sorted(set(account_codes) - {code for code, _ in balances})
    if missing_accounts:
        warnings.append(f"以下账户在基准日前没有余额快照：{', '.join(missing_accounts)}")

    end_date = as_of + timedelta(days=89)
    inflows: list[CashflowEntry] = []
    overdue_unconfirmed = ZERO
    for receivable, _, fact in receivable_facts(db, batch.id):
        if fact.outstanding <= 0:
            continue
        effective_date = fact.expected_date or fact.due_date
        if effective_date < as_of:
            overdue_unconfirmed += fact.outstanding
            continue
        if effective_date <= end_date:
            inflows.append(CashflowEntry(receivable.id, receivable.receivable_no, effective_date, fact.outstanding))

    expenses = db.scalars(
        select(PlannedExpense).where(
            PlannedExpense.import_batch_id == batch.id,
            PlannedExpense.status == "active",
            PlannedExpense.approval_status.in_(["planned", "pending", "approved"]),
            PlannedExpense.planned_date.between(as_of, end_date),
        )
    ).all()
    outflows = [CashflowEntry(item.id, item.expense_no, item.planned_date, Decimal(item.planned_amount)) for item in expenses]
    warnings.append("当前没有实际付款表，计划支出状态未及时更新可能造成重复预测")
    return opening_balance, inflows, outflows, warnings, overdue_unconfirmed


def cashflow_forecast(db: Session, as_of: date, batch_id: UUID | None = None) -> dict:
    batch = current_batch(db, batch_id)
    opening_balance, inflows, outflows, warnings, overdue_unconfirmed = forecast_inputs(db, as_of, batch)
    curve = build_daily_forecast(as_of, opening_balance, inflows, outflows)
    windows = []
    for days in (30, 60, 90):
        summary = curve_summary(curve[:days])
        windows.append({
            "days": days,
            "minimumBalance": money(summary["minimum_balance"]),
            "maximumGap": money(summary["maximum_gap"]),
            "gapDate": summary["gap_date"].isoformat() if summary["gap_date"] else None,
        })
    total = curve_summary(curve)
    return {
        "asOfDate": as_of.isoformat(),
        "forecastEndDate": curve[-1].flow_date.isoformat(),
        "batchId": str(batch.id),
        "ruleVersion": get_settings().rule_version,
        "reviewStatus": get_settings().review_status,
        "openingBalance": money(opening_balance),
        "safetyLine": money(ZERO),
        "windows": windows,
        "firstBreachDate": total["first_breach_date"].isoformat() if total["first_breach_date"] else None,
        "recoveryDate": total["recovery_date"].isoformat() if total["recovery_date"] else None,
        "overdueUnconfirmedAmount": money(overdue_unconfirmed),
        "daily": [
            {
                "date": point.flow_date.isoformat(),
                "expectedInflow": money(point.inflow),
                "plannedOutflow": money(point.outflow),
                "netFlow": money(point.net_flow),
                "predictedBalance": money(point.balance),
            }
            for point in curve
        ],
        "warnings": warnings,
    }
