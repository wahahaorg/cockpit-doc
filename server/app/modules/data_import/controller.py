from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.database.session import get_db
from app.modules.data_import.models import ImportBatch, RawImportRow
from app.modules.data_import.service import create_import, publish_batch

router = APIRouter(prefix="/imports", tags=["imports"])


def batch_data(batch: ImportBatch) -> dict:
    return {"id": str(batch.id), "batchNo": batch.batch_no, "status": batch.status, "fileName": batch.file_name, "templateVersion": batch.template_version, "dataPeriodStart": batch.data_period_start.isoformat(), "dataPeriodEnd": batch.data_period_end.isoformat(), "totalRows": batch.total_rows, "validRows": batch.valid_rows, "errorRows": batch.error_rows, "warningRows": batch.warning_rows, "version": batch.version, "publishedAt": batch.published_at.isoformat() if batch.published_at else None, "createdAt": batch.created_at.isoformat() if batch.created_at else None}


@router.post("", status_code=201)
async def upload_import(file: UploadFile = File(...), templateVersion: str = Form(...), dataPeriodStart: date = Form(...), dataPeriodEnd: date = Form(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise AppError("unsupported_file_type", "仅支持 .xlsx 文件", 415)
    content = await file.read(get_settings().max_upload_bytes + 1)
    if len(content) > get_settings().max_upload_bytes:
        raise AppError("file_too_large", "上传文件超过大小限制", 413)
    return {"data": batch_data(create_import(db, content, file.filename, templateVersion, dataPeriodStart, dataPeriodEnd))}


@router.get("")
def list_imports(page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100), status: str | None = None, db: Session = Depends(get_db)):
    stmt = select(ImportBatch)
    count = select(func.count()).select_from(ImportBatch)
    if status: stmt = stmt.where(ImportBatch.status == status); count = count.where(ImportBatch.status == status)
    total = db.scalar(count) or 0
    items = db.scalars(stmt.order_by(ImportBatch.created_at.desc()).offset((page - 1) * pageSize).limit(pageSize)).all()
    return {"data": [batch_data(x) for x in items], "pagination": {"page": page, "pageSize": pageSize, "total": total, "totalPages": (total + pageSize - 1) // pageSize}}


@router.get("/{batch_id}")
def get_import(batch_id: UUID, db: Session = Depends(get_db)):
    batch = db.get(ImportBatch, batch_id)
    if not batch: raise AppError("batch_not_found", "导入批次不存在", 404)
    summary = db.execute(select(RawImportRow.sheet_name, RawImportRow.validation_status, func.count()).where(RawImportRow.import_batch_id == batch_id).group_by(RawImportRow.sheet_name, RawImportRow.validation_status)).all()
    sheet_stats: dict[str, dict] = {}
    for sheet_name, validation_status, count in summary:
        item = sheet_stats.setdefault(sheet_name, {"sheetName": sheet_name, "totalRows": 0, "validRows": 0, "warningRows": 0, "errorRows": 0})
        item["totalRows"] += count
        item[f"{validation_status}Rows"] += count
    data = batch_data(batch); data["sheets"] = list(sheet_stats.values())
    return {"data": data}


@router.get("/{batch_id}/rows")
def list_rows(batch_id: UUID, sheetName: str | None = None, validationStatus: str | None = None, page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    filters = [RawImportRow.import_batch_id == batch_id]
    if sheetName: filters.append(RawImportRow.sheet_name == sheetName)
    if validationStatus: filters.append(RawImportRow.validation_status == validationStatus)
    total = db.scalar(select(func.count()).select_from(RawImportRow).where(*filters)) or 0
    rows = db.scalars(select(RawImportRow).where(*filters).order_by(RawImportRow.sheet_name, RawImportRow.row_no).offset((page - 1) * pageSize).limit(pageSize)).all()
    return {"data": [{"id": str(r.id), "sheetName": r.sheet_name, "rowNo": r.row_no, "rawData": r.raw_data, "normalizedData": r.normalized_data, "validationStatus": r.validation_status, "validationMessages": r.validation_messages} for r in rows], "pagination": {"page": page, "pageSize": pageSize, "total": total, "totalPages": (total + pageSize - 1) // pageSize}}


@router.get("/{batch_id}/validation-errors")
def validation_errors(batch_id: UUID, db: Session = Depends(get_db)):
    rows = db.scalars(select(RawImportRow).where(RawImportRow.import_batch_id == batch_id, RawImportRow.validation_status.in_(["error", "warning"]))).all()
    errors = [{"sheetName": r.sheet_name, "rowNo": r.row_no, **m} for r in rows for m in r.validation_messages]
    return {"data": errors, "pagination": {"page": 1, "pageSize": len(errors), "total": len(errors), "totalPages": 1 if errors else 0}}


class PublishBody(BaseModel):
    version: int
    reviewNote: str | None = None


@router.post("/{batch_id}:publish")
def publish(batch_id: UUID, body: PublishBody, db: Session = Depends(get_db)):
    return {"data": batch_data(publish_batch(db, batch_id, body.version, body.reviewNote))}
