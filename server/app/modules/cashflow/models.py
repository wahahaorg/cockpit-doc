import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, IdMixin, TimestampMixin


class SourceMixin:
    import_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batch.id", ondelete="CASCADE"), index=True)
    source_row_no: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="active")
    version: Mapped[int] = mapped_column(Integer, default=1)


class AccountBalance(Base, IdMixin, TimestampMixin, SourceMixin):
    __tablename__ = "account_balance"
    __table_args__ = (UniqueConstraint("account_code", "snapshot_date", "import_batch_id"),)
    account_code: Mapped[str] = mapped_column(String(64))
    account_name: Mapped[str] = mapped_column(String(120))
    snapshot_date: Mapped[date] = mapped_column(Date, index=True)
    available_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3), default="CNY")
    restricted_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    remark: Mapped[str | None] = mapped_column(String(500))


class Customer(Base, IdMixin, TimestampMixin):
    __tablename__ = "customer"
    customer_code: Mapped[str] = mapped_column(String(64), unique=True)
    customer_name: Mapped[str] = mapped_column(String(200))
    customer_level: Mapped[str | None] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Receivable(Base, IdMixin, TimestampMixin, SourceMixin):
    __tablename__ = "receivable"
    __table_args__ = (UniqueConstraint("receivable_no", "import_batch_id"), Index("ix_receivable_due_status", "agreed_due_date", "source_status"))
    receivable_no: Mapped[str] = mapped_column(String(64))
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customer.id"), index=True)
    business_ref_no: Mapped[str | None] = mapped_column(String(64))
    receivable_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    agreed_due_date: Mapped[date] = mapped_column(Date)
    expected_date: Mapped[date | None] = mapped_column(Date)
    owner_code: Mapped[str] = mapped_column(String(64), index=True)
    owner_name: Mapped[str] = mapped_column(String(100))
    business_line: Mapped[str | None] = mapped_column(String(100))
    source_status: Mapped[str] = mapped_column(String(20), default="open")
    remark: Mapped[str | None] = mapped_column(String(500))


class Collection(Base, IdMixin, TimestampMixin, SourceMixin):
    __tablename__ = "collection"
    collection_no: Mapped[str] = mapped_column(String(64), unique=True)
    receivable_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("receivable.id"), index=True)
    collection_date: Mapped[date] = mapped_column(Date, index=True)
    collection_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3), default="CNY")
    bank_reference: Mapped[str | None] = mapped_column(String(100))
    remark: Mapped[str | None] = mapped_column(String(500))


class PlannedExpense(Base, IdMixin, TimestampMixin, SourceMixin):
    __tablename__ = "planned_expense"
    __table_args__ = (UniqueConstraint("expense_no", "import_batch_id"),)
    expense_no: Mapped[str] = mapped_column(String(64))
    expense_name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(100))
    planned_date: Mapped[date] = mapped_column(Date, index=True)
    planned_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    owner_code: Mapped[str] = mapped_column(String(64))
    owner_name: Mapped[str] = mapped_column(String(100))
    rigidity: Mapped[str] = mapped_column(String(16))
    approval_status: Mapped[str] = mapped_column(String(20), index=True)
    remark: Mapped[str | None] = mapped_column(String(500))


class FollowupRecord(Base, IdMixin):
    __tablename__ = "followup_record"
    receivable_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("receivable.id"), index=True)
    followed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now().astimezone())
    followed_by_code: Mapped[str] = mapped_column(String(64))
    followed_by_name: Mapped[str] = mapped_column(String(100))
    content: Mapped[str] = mapped_column(String(1000))
    next_followup_date: Mapped[date | None] = mapped_column(Date)
    promised_collection_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now().astimezone())


class Task(Base, IdMixin, TimestampMixin):
    __tablename__ = "task"
    __table_args__ = (Index("ix_task_status_due_risk", "status", "due_date", "risk_level"),)
    task_type: Mapped[str] = mapped_column(String(32))
    source_type: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[uuid.UUID | None] = mapped_column()
    title: Mapped[str] = mapped_column(String(200))
    risk_level: Mapped[str] = mapped_column(String(16))
    owner_code: Mapped[str | None] = mapped_column(String(64))
    owner_name: Mapped[str | None] = mapped_column(String(100))
    due_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    boss_intervention_required: Mapped[bool] = mapped_column(Boolean, default=False)
    rule_version: Mapped[str] = mapped_column(String(32))
    import_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batch.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
