from calendar import monthrange
from dataclasses import dataclass
from datetime import date
from decimal import Decimal


ZERO = Decimal("0.00")


@dataclass(frozen=True)
class ReceivableFact:
    id: object
    amount: Decimal
    due_date: date
    expected_date: date | None
    collected: Decimal

    @property
    def outstanding(self) -> Decimal:
        return max(self.amount - self.collected, ZERO)

    def overdue_days(self, as_of: date) -> int:
        return max((as_of - self.due_date).days, 0) if self.outstanding > 0 else 0

    def risk_level(self, as_of: date) -> str:
        days = self.overdue_days(as_of)
        if days >= 30 or (days > 0 and self.outstanding >= Decimal("1000000")):
            return "red"
        if days > 0:
            return "yellow"
        return "green"


def month_bounds(as_of: date) -> tuple[date, date]:
    return date(as_of.year, as_of.month, 1), date(as_of.year, as_of.month, monthrange(as_of.year, as_of.month)[1])


def cash_gap(available: Decimal, expected_remaining: Decimal, planned_remaining: Decimal) -> Decimal:
    return max(-(available + expected_remaining - planned_remaining), ZERO)

