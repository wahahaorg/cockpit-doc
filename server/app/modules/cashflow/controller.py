from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.database.session import get_db
from app.modules.cashflow.models import AccountBalance, Collection, Customer, FollowupRecord, PlannedExpense, Receivable, Task
from app.modules.data_import.service import current_batch

router = APIRouter(tags=["standard-data"])


def _page(db: Session, stmt, count_stmt, page: int, size: int, serializer):
    total = db.scalar(count_stmt) or 0; rows = db.scalars(stmt.offset((page - 1) * size).limit(size)).all()
    return {"data": [serializer(r) for r in rows], "pagination": {"page": page, "pageSize": size, "total": total, "totalPages": (total + size - 1) // size}}


@router.get("/account-balances")
def balances(batchId: UUID | None = None, page: int = 1, pageSize: int = Query(20, le=100), db: Session = Depends(get_db)):
    b = current_batch(db, batchId); f = [AccountBalance.import_batch_id == b.id]
    return _page(db, select(AccountBalance).where(*f).order_by(AccountBalance.snapshot_date.desc()), select(func.count()).select_from(AccountBalance).where(*f), page, pageSize, lambda x: {"id": str(x.id), "accountCode": x.account_code, "accountName": x.account_name, "snapshotDate": x.snapshot_date.isoformat(), "availableBalance": str(x.available_balance), "currency": x.currency})


@router.get("/customers")
def customers(keyword: str | None = None, page: int = 1, pageSize: int = Query(20, le=100), db: Session = Depends(get_db)):
    f = [Customer.active.is_(True)]
    if keyword: f.append(Customer.customer_name.contains(keyword))
    return _page(db, select(Customer).where(*f), select(func.count()).select_from(Customer).where(*f), page, pageSize, lambda x: {"id": str(x.id), "customerCode": x.customer_code, "customerName": x.customer_name})


@router.get("/receivables")
def receivables(batchId: UUID | None = None, page: int = 1, pageSize: int = Query(20, le=100), db: Session = Depends(get_db)):
    b = current_batch(db, batchId); f = [Receivable.import_batch_id == b.id]
    return _page(db, select(Receivable).where(*f), select(func.count()).select_from(Receivable).where(*f), page, pageSize, lambda x: {"id": str(x.id), "receivableNo": x.receivable_no, "receivableAmount": str(x.receivable_amount), "agreedDueDate": x.agreed_due_date.isoformat(), "ownerCode": x.owner_code, "ownerName": x.owner_name, "sourceStatus": x.source_status})


@router.get("/collections")
def collections(batchId: UUID | None = None, page: int = 1, pageSize: int = Query(20, le=100), db: Session = Depends(get_db)):
    b = current_batch(db, batchId); f = [Collection.import_batch_id == b.id]
    return _page(db, select(Collection).where(*f), select(func.count()).select_from(Collection).where(*f), page, pageSize, lambda x: {"id": str(x.id), "collectionNo": x.collection_no, "receivableId": str(x.receivable_id), "collectionDate": x.collection_date.isoformat(), "collectionAmount": str(x.collection_amount)})


@router.get("/planned-expenses")
def expenses(batchId: UUID | None = None, page: int = 1, pageSize: int = Query(20, le=100), db: Session = Depends(get_db)):
    b = current_batch(db, batchId); f = [PlannedExpense.import_batch_id == b.id]
    return _page(db, select(PlannedExpense).where(*f), select(func.count()).select_from(PlannedExpense).where(*f), page, pageSize, lambda x: {"id": str(x.id), "expenseNo": x.expense_no, "expenseName": x.expense_name, "plannedDate": x.planned_date.isoformat(), "plannedAmount": str(x.planned_amount), "approvalStatus": x.approval_status})


class FollowupBody(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    nextFollowupDate: date | None = None
    promisedCollectionDate: date | None = None


@router.post("/receivables/{receivable_id}/followups", status_code=201)
def add_followup(receivable_id: UUID, body: FollowupBody, db: Session = Depends(get_db)):
    if not db.get(Receivable, receivable_id): raise AppError("receivable_not_found", "应收事项不存在", 404)
    item = FollowupRecord(receivable_id=receivable_id, followed_by_code="admin", followed_by_name="管理员", content=body.content, next_followup_date=body.nextFollowupDate, promised_collection_date=body.promisedCollectionDate)
    db.add(item); db.commit()
    return {"data": {"id": str(item.id), "receivableId": str(item.receivable_id), "content": item.content, "followedAt": item.followed_at.isoformat()}}


@router.get("/tasks")
def tasks(date_: date | None = Query(None, alias="date"), status: str | None = None, page: int = 1, pageSize: int = Query(20, le=100), db: Session = Depends(get_db)):
    b = current_batch(db); f = [Task.import_batch_id == b.id]
    if date_: f.append(Task.due_date <= date_)
    if status: f.append(Task.status == status)
    return _page(db, select(Task).where(*f), select(func.count()).select_from(Task).where(*f), page, pageSize, lambda x: {"id": str(x.id), "title": x.title, "taskType": x.task_type, "riskLevel": x.risk_level, "ownerCode": x.owner_code, "ownerName": x.owner_name, "dueDate": x.due_date.isoformat(), "status": x.status, "bossInterventionRequired": x.boss_intervention_required, "version": x.version})


class TaskPatch(BaseModel):
    status: str
    ownerCode: str | None = None
    ownerName: str | None = None
    version: int


@router.patch("/tasks/{task_id}")
def patch_task(task_id: UUID, body: TaskPatch, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task: raise AppError("task_not_found", "任务不存在", 404)
    if task.version != body.version: raise AppError("version_conflict", "任务版本已变化", 409)
    transitions = {"pending": {"in_progress", "completed", "closed"}, "in_progress": {"completed", "closed"}, "completed": {"closed"}, "closed": set()}
    if body.status != task.status and body.status not in transitions.get(task.status, set()): raise AppError("invalid_task_transition", "任务状态迁移无效", 409)
    task.status = body.status; task.owner_code = body.ownerCode or task.owner_code; task.owner_name = body.ownerName or task.owner_name; task.version += 1; db.commit()
    return {"data": {"id": str(task.id), "status": task.status, "version": task.version}}

