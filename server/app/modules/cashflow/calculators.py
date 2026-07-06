from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal


ZERO = Decimal("0.00")


@dataclass(frozen=True)
class CashflowEntry:
    source_id: object
    source_no: str
    flow_date: date
    amount: Decimal


@dataclass(frozen=True)
class DailyCashflow:
    flow_date: date
    inflow: Decimal
    outflow: Decimal
    net_flow: Decimal
    balance: Decimal


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
        days_to_due = (self.due_date - as_of).days
        if days > 0 or 0 <= days_to_due <= 2:
            return "yellow"
        return "green"


def month_bounds(as_of: date) -> tuple[date, date]:
    return date(as_of.year, as_of.month, 1), date(as_of.year, as_of.month, monthrange(as_of.year, as_of.month)[1])


def cash_gap(available: Decimal, expected_remaining: Decimal, planned_remaining: Decimal) -> Decimal:
    return max(-(available + expected_remaining - planned_remaining), ZERO)


def build_daily_forecast(
    as_of: date,
    opening_balance: Decimal,
    inflows: list[CashflowEntry],
    outflows: list[CashflowEntry],
    days: int = 90,
) -> list[DailyCashflow]:
    """Build one deterministic rolling curve reused by every cashflow decision module."""
    inflow_by_date: dict[date, Decimal] = {}
    outflow_by_date: dict[date, Decimal] = {}
    for item in inflows:
        inflow_by_date[item.flow_date] = inflow_by_date.get(item.flow_date, ZERO) + item.amount
    for item in outflows:
        outflow_by_date[item.flow_date] = outflow_by_date.get(item.flow_date, ZERO) + item.amount

    balance = opening_balance
    result: list[DailyCashflow] = []
    for offset in range(days):
        flow_date = as_of + timedelta(days=offset)
        inflow = inflow_by_date.get(flow_date, ZERO)
        outflow = outflow_by_date.get(flow_date, ZERO)
        net_flow = inflow - outflow
        balance += net_flow
        result.append(DailyCashflow(flow_date, inflow, outflow, net_flow, balance))
    return result


def curve_summary(curve: list[DailyCashflow], safety_line: Decimal = ZERO) -> dict:
    if not curve:
        return {
            "minimum_balance": ZERO,
            "maximum_gap": ZERO,
            "gap_date": None,
            "first_breach_date": None,
            "recovery_date": None,
        }
    minimum = min(point.balance for point in curve)
    gap_date = next(point.flow_date for point in curve if point.balance == minimum)
    first_breach_index = next((i for i, point in enumerate(curve) if point.balance < safety_line), None)
    recovery_date = None
    if first_breach_index is not None:
        for index in range(first_breach_index + 1, len(curve)):
            if curve[index].balance >= safety_line and all(point.balance >= safety_line for point in curve[index:]):
                recovery_date = curve[index].flow_date
                break
    return {
        "minimum_balance": minimum,
        "maximum_gap": max(safety_line - minimum, ZERO),
        "gap_date": gap_date,
        "first_breach_date": curve[first_breach_index].flow_date if first_breach_index is not None else None,
        "recovery_date": recovery_date,
    }
