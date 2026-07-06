import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, IdMixin, TimestampMixin


class PaymentAssessment(Base, IdMixin, TimestampMixin):
    __tablename__ = "payment_assessment"
    __table_args__ = (
        UniqueConstraint("planned_expense_id", "as_of_date", "import_batch_id", "rule_version"),
        Index("ix_payment_assessment_batch_date_decision", "import_batch_id", "as_of_date", "decision"),
    )
    planned_expense_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("planned_expense.id", ondelete="CASCADE"), index=True)
    as_of_date: Mapped[date] = mapped_column(Date)
    import_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batch.id", ondelete="CASCADE"), index=True)
    rule_version: Mapped[str] = mapped_column(String(32))
    queue_order: Mapped[int | None] = mapped_column(Integer)
    eligibility_result: Mapped[str] = mapped_column(String(24))
    decision: Mapped[str] = mapped_column(String(24))
    reason_codes: Mapped[list] = mapped_column(JSON, default=list)
    min_balance_before: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    min_balance_after: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    gap_before: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    gap_after: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    gap_increase: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    gap_date: Mapped[date | None] = mapped_column(Date)
    recovery_date: Mapped[date | None] = mapped_column(Date)
    evidence_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    ai_explanation: Mapped[str | None] = mapped_column(Text)


class DecisionEvent(Base, IdMixin, TimestampMixin):
    __tablename__ = "decision_event"
    __table_args__ = (
        UniqueConstraint("event_key"),
        Index("ix_decision_event_status_risk_date", "status", "risk_level", "impact_date"),
    )
    business_key: Mapped[str] = mapped_column(String(160), index=True)
    event_key: Mapped[str] = mapped_column(String(180))
    risk_cycle_no: Mapped[int] = mapped_column(Integer, default=1)
    event_type: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[uuid.UUID] = mapped_column()
    source_task_id: Mapped[uuid.UUID | None] = mapped_column()
    title: Mapped[str] = mapped_column(String(200))
    risk_level: Mapped[str] = mapped_column(String(16))
    impact_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    impact_date: Mapped[date | None] = mapped_column(Date)
    owner_code: Mapped[str | None] = mapped_column(String(64))
    owner_name: Mapped[str | None] = mapped_column(String(100))
    reason_codes: Mapped[list] = mapped_column(JSON, default=list)
    evidence_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    allowed_options: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    selected_option: Mapped[str | None] = mapped_column(String(40))
    decision_note: Mapped[str | None] = mapped_column(String(1000))
    decision_payload: Mapped[dict | None] = mapped_column(JSON)
    decided_by: Mapped[str | None] = mapped_column(String(100))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_reason: Mapped[str | None] = mapped_column(String(200))
    import_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batch.id"), index=True)
    rule_version: Mapped[str] = mapped_column(String(32))
    version: Mapped[int] = mapped_column(Integer, default=1)
