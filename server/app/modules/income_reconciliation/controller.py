from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import FileResponse

from app.core.exceptions import AppError
from app.modules.income_reconciliation import service

router = APIRouter(prefix="/income-reconciliation", tags=["income-reconciliation"])


@router.post("/jobs", status_code=201)
async def create_income_reconciliation_job(
    request: Request,
):
    form = await request.form()
    invoice_file = _first_file(form, "invoice_file", "invoiceFile")
    cashflow_file = _first_file(form, "cashflow_file", "cashflowFile")
    settlement_files = _all_files(form, "settlement_files", "settlementFiles", "settlement_files[]", "settlementFiles[]")
    period_start = form.get("periodStart") or form.get("period_start")
    period_end = form.get("periodEnd") or form.get("period_end")
    if not invoice_file:
        raise AppError("missing_invoice_file", "请上传开票明细 Excel", 422)
    if not cashflow_file:
        raise AppError("missing_cashflow_file", "请上传服务收支明细 Excel", 422)
    return {"data": service.create_job(invoice_file, cashflow_file, settlement_files, period_start, period_end)}


@router.post("/jobs/{job_id}/parse")
def parse_income_reconciliation_job(job_id: str):
    return {"data": service.parse_job(job_id)}


@router.post("/jobs/{job_id}/generate")
def generate_income_reconciliation_job(job_id: str):
    return {"data": service.generate_job(job_id)}


@router.get("/jobs/{job_id}")
def get_income_reconciliation_job(job_id: str):
    return {"data": service.get_job(job_id)}


@router.get("/jobs/{job_id}/files/{file_id}")
def get_income_reconciliation_file_result(job_id: str, file_id: str):
    return {"data": service.get_file_result(job_id, file_id)}


@router.get("/jobs/{job_id}/download")
def download_income_reconciliation_excel(job_id: str):
    path = service.download_path(job_id)
    return FileResponse(
        path,
        filename="4-5月技术服务收入链路核对表.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def _first_file(form, *keys: str) -> UploadFile | None:
    for key in keys:
        value = form.get(key)
        if _is_upload_file(value):
            return value
    return None


def _all_files(form, *keys: str) -> list[UploadFile]:
    files: list[UploadFile] = []
    for key in keys:
        files.extend(value for value in form.getlist(key) if _is_upload_file(value))
    return files


def _is_upload_file(value) -> bool:
    return hasattr(value, "filename") and hasattr(value, "file")
