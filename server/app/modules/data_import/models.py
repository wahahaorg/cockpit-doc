import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, IdMixin, TimestampMixin


class ImportBatch(Base, IdMixin, TimestampMixin):
    __tablename__ = "import_batch"
    batch_no: Mapped[str] = mapped_column(String(40), unique=True)
    file_name: Mapped[str] = mapped_column(String(255))
    file_sha256: Mapped[str] = mapped_column(String(64), index=True)
    template_version: Mapped[str] = mapped_column(String(20))
    data_period_start: Mapped[date] = mapped_column(Date)
    data_period_end: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(24), default="uploaded", index=True)
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    valid_rows: Mapped[int] = mapped_column(Integer, default=0)
    error_rows: Mapped[int] = mapped_column(Integer, default=0)
    warning_rows: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by: Mapped[str] = mapped_column(String(100), default="admin")
    published_by: Mapped[str | None] = mapped_column(String(100))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(String(500))
    version: Mapped[int] = mapped_column(Integer, default=1)
    rows: Mapped[list["RawImportRow"]] = relationship(cascade="all, delete-orphan")


class RawImportRow(Base, IdMixin):
    __tablename__ = "raw_import_row"
    __table_args__ = (UniqueConstraint("import_batch_id", "sheet_name", "row_no"), Index("ix_raw_import_row_batch_status", "import_batch_id", "validation_status"))
    import_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batch.id", ondelete="CASCADE"))
    sheet_name: Mapped[str] = mapped_column(String(100))
    row_no: Mapped[int] = mapped_column(Integer)
    raw_data: Mapped[dict] = mapped_column(JSON)
    normalized_data: Mapped[dict | None] = mapped_column(JSON)
    validation_status: Mapped[str] = mapped_column(String(16))
    validation_messages: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now().astimezone())

