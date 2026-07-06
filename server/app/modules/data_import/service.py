import hashlib
import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.modules.cashflow.models import AccountBalance, Collection, Customer, PlannedExpense, Receivable, Task
from app.modules.data_import.models import ImportBatch, RawImportRow
from app.modules.data_import.parsers import ParsedRow, parse_workbook

logger = logging.getLogger(__name__)


def create_import(db: Session, content: bytes, file_name: str, template_version: str, period_start: date, period_end: date) -> ImportBatch:
    if template_version != "V0.1":
        raise AppError("template_not_supported", "仅支持模板 V0.1", 422)
    if period_end < period_start:
        raise AppError("invalid_period", "数据结束日期不能早于开始日期", 422)
    digest = hashlib.sha256(content).hexdigest()
    if db.scalar(select(ImportBatch.id).where(ImportBatch.file_sha256 == digest)):
        raise AppError("duplicate_file", "该文件已上传", 409)
    try:
        parsed = parse_workbook(content)
    except ValueError as exc:
        raise AppError("invalid_workbook", str(exc), 422) from exc
    seq = (db.scalar(select(func.count()).select_from(ImportBatch)) or 0) + 1
    batch = ImportBatch(batch_no=f"IMP-{datetime.now():%Y%m%d}-{seq:03d}", file_name=file_name, file_sha256=digest, template_version=template_version, data_period_start=period_start, data_period_end=period_end, status="pending_review", uploaded_by="admin")
    db.add(batch)
    db.flush()
    for row in parsed:
        db.add(RawImportRow(import_batch_id=batch.id, sheet_name=row.sheet_name, row_no=row.row_no, raw_data=row.raw_data, normalized_data=_json_normalized(row.normalized_data), validation_status=row.status, validation_messages=row.messages))
    batch.total_rows = len(parsed)
    batch.valid_rows = sum(r.status == "valid" for r in parsed)
    batch.error_rows = sum(r.status == "error" for r in parsed)
    batch.warning_rows = sum(r.status == "warning" for r in parsed)
    if batch.error_rows:
        batch.status = "validation_failed"
    _persist_standard_rows(db, batch.id, parsed)
    db.commit()
    return batch


def _json_normalized(data: dict) -> dict:
    return {k: str(v) if isinstance(v, Decimal) else v.isoformat() if isinstance(v, date) else v for k, v in data.items()}


def _persist_standard_rows(db: Session, batch_id: UUID, rows: list[ParsedRow]) -> None:
    customer_cache: dict[str, Customer] = {}
    receivable_cache: dict[str, Receivable] = {}
    valid = [r for r in rows if r.status != "error"]
    for row in valid:
        d = row.normalized_data
        logger.debug("normalized import row: sheet=%s row=%d data=%s", row.sheet_name, row.row_no, d)
        if row.sheet_name == "账户余额":
            db.add(AccountBalance(import_batch_id=batch_id, source_row_no=row.row_no, account_code=d["account_code"], account_name=d["account_name"], snapshot_date=d["snapshot_date"], available_balance=d["available_balance"], currency=d["currency"] or "CNY", restricted_amount=d["restricted_amount"] or Decimal("0"), remark=d["remark"]))
        elif row.sheet_name == "应收款":
            customer = db.scalar(select(Customer).where(Customer.customer_code == d["customer_code"]))
            if not customer:
                customer = Customer(customer_code=d["customer_code"], customer_name=d["customer_name"])
                db.add(customer); db.flush()
            customer_cache[d["customer_code"]] = customer
            rec = Receivable(import_batch_id=batch_id, source_row_no=row.row_no, receivable_no=d["receivable_no"], customer_id=customer.id, business_ref_no=d["business_ref_no"], receivable_amount=d["receivable_amount"], agreed_due_date=d["agreed_due_date"], expected_date=d["expected_date"], owner_code=d["owner_code"], owner_name=d["owner_name"], business_line=d["business_line"], source_status=d["source_status"], remark=d["remark"])
            db.add(rec); db.flush(); receivable_cache[d["receivable_no"]] = rec
    for row in valid:
        d = row.normalized_data
        if row.sheet_name == "实际回款":
            rec = receivable_cache[d["receivable_no"]]
            db.add(Collection(import_batch_id=batch_id, source_row_no=row.row_no, collection_no=d["collection_no"], receivable_id=rec.id, collection_date=d["collection_date"], collection_amount=d["collection_amount"], currency=d["currency"] or "CNY", bank_reference=d["bank_reference"], remark=d["remark"]))
        elif row.sheet_name == "计划支出":
            db.add(PlannedExpense(import_batch_id=batch_id, source_row_no=row.row_no, expense_no=d["expense_no"], expense_name=d["expense_name"], category=d["category"], planned_date=d["planned_date"], planned_amount=d["planned_amount"], owner_code=d["owner_code"], owner_name=d["owner_name"], rigidity=d["rigidity"], approval_status=d["approval_status"], remark=d["remark"]))


def publish_batch(db: Session, batch_id: UUID, version: int, review_note: str | None) -> ImportBatch:
    batch = db.get(ImportBatch, batch_id)
    if not batch:
        raise AppError("batch_not_found", "导入批次不存在", 404)
    if batch.version != version:
        raise AppError("version_conflict", "批次版本已变化", 409)
    if batch.error_rows:
        raise AppError("batch_has_blocking_errors", "批次存在阻断错误，不能发布", 422, {"errorRows": batch.error_rows})
    if batch.status not in {"pending_review", "published"}:
        raise AppError("invalid_batch_status", "当前批次状态不能发布", 409)
    db.execute(update(ImportBatch).where(ImportBatch.status == "published", ImportBatch.id != batch.id).values(status="pending_review", version=ImportBatch.version + 1))
    batch.status = "published"; batch.published_by = "admin"; batch.published_at = datetime.now(timezone.utc); batch.review_note = review_note; batch.version += 1
    db.flush()
    _generate_tasks(db, batch)
    db.commit()
    return batch


def _generate_tasks(db: Session, batch: ImportBatch) -> None:
    from app.core.config import get_settings
    from app.modules.dashboard.service import risks
    from app.modules.decision.service import refresh_decision_events

    as_of = date.today()
    db.execute(delete(Task).where(Task.import_batch_id == batch.id, Task.status == "pending"))
    for item in risks(db, as_of):
        if item["overdueDays"] <= 0:
            continue
        db.add(Task(task_type="collection_overdue", source_type="receivable", source_id=UUID(item["receivableId"]), title=f"催收 {item['customerName']} · {item['outstandingAmount']} 元", risk_level=item["riskLevel"], owner_code=item["ownerCode"], owner_name=item["ownerName"], due_date=as_of, status="pending", boss_intervention_required=item["riskLevel"] == "red", rule_version=get_settings().rule_version, import_batch_id=batch.id))
    # Cash gaps are evidence for receivable/payment decisions, not a third boss-event source.
    refresh_decision_events(db, as_of, batch)


def current_batch(db: Session, batch_id: UUID | None = None) -> ImportBatch:
    batch = db.get(ImportBatch, batch_id) if batch_id else db.scalar(select(ImportBatch).where(ImportBatch.status == "published").order_by(ImportBatch.published_at.desc()))
    if not batch:
        raise AppError("published_batch_not_found", "暂无已发布数据批次", 404)
    return batch
