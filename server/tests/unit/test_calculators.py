from datetime import date
from decimal import Decimal

from app.modules.cashflow.calculators import ReceivableFact, cash_gap


def test_partial_collection_keeps_outstanding_overdue():
    fact = ReceivableFact("r1", Decimal("1200000"), date(2026, 5, 12), None, Decimal("200000"))
    assert fact.outstanding == Decimal("1000000")
    assert fact.overdue_days(date(2026, 7, 2)) == 51
    assert fact.risk_level(date(2026, 7, 2)) == "red"


def test_cash_gap_never_negative():
    assert cash_gap(Decimal("300"), Decimal("100"), Decimal("500")) == Decimal("100")
    assert cash_gap(Decimal("500"), Decimal("100"), Decimal("300")) == Decimal("0")

