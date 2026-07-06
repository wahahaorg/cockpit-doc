from datetime import date
from decimal import Decimal

from app.modules.cashflow.calculators import CashflowEntry, ReceivableFact, build_daily_forecast, cash_gap, curve_summary


def test_partial_collection_keeps_outstanding_overdue():
    fact = ReceivableFact("r1", Decimal("1200000"), date(2026, 5, 12), None, Decimal("200000"))
    assert fact.outstanding == Decimal("1000000")
    assert fact.overdue_days(date(2026, 7, 2)) == 51
    assert fact.risk_level(date(2026, 7, 2)) == "red"


def test_cash_gap_never_negative():
    assert cash_gap(Decimal("300"), Decimal("100"), Decimal("500")) == Decimal("100")
    assert cash_gap(Decimal("500"), Decimal("100"), Decimal("300")) == Decimal("0")


def test_daily_forecast_and_window_summary_use_lowest_balance():
    start = date(2026, 7, 5)
    curve = build_daily_forecast(
        start,
        Decimal("500"),
        [CashflowEntry("r1", "AR-1", date(2026, 7, 10), Decimal("300"))],
        [
            CashflowEntry("e1", "EXP-1", date(2026, 7, 15), Decimal("400")),
            CashflowEntry("e2", "EXP-2", date(2026, 7, 25), Decimal("600")),
        ],
        days=30,
    )
    summary = curve_summary(curve)
    assert summary["minimum_balance"] == Decimal("-200")
    assert summary["maximum_gap"] == Decimal("200")
    assert summary["gap_date"] == date(2026, 7, 25)
