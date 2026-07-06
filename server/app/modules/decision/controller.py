from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.modules.cashflow.forecast import cashflow_forecast
from app.modules.cashflow.models import PlannedExpense
from app.modules.dashboard.service import risks
from app.modules.data_import.service import current_batch
from app.modules.decision.models import DecisionEvent
from app.modules.decision.service import decide_event, ensure_payment_assessment_explanation, refresh_decision_events, refresh_payment_assessments, serialize_assessment, serialize_event


router = APIRouter(tags=["decision"])


@router.get("/cashflow-forecasts")
def get_cashflow_forecast(asOfDate: date = Query(default_factory=date.today), db: Session = Depends(get_db)):
    return {"data": cashflow_forecast(db, asOfDate)}


@router.get("/receivable-risks/top3")
def get_receivable_risk_top3(asOfDate: date = Query(default_factory=date.today), db: Session = Depends(get_db)):
    batch = current_batch(db)
    candidates = [item for item in risks(db, asOfDate) if item["riskLevel"] in {"red", "yellow"}]
    return {
        "data": {
            "asOfDate": asOfDate.isoformat(),
            "batchId": str(batch.id),
            "candidateCount": len(candidates),
            "redCount": sum(item["riskLevel"] == "red" for item in candidates),
            "yellowCount": sum(item["riskLevel"] == "yellow" for item in candidates),
            "items": candidates[:3],
        }
    }


@router.get("/payment-recommendations/top3")
def get_payment_recommendations(asOfDate: date = Query(default_factory=date.today), db: Session = Depends(get_db)):
    batch = current_batch(db)
    assessments = refresh_payment_assessments(db, asOfDate, batch)
    priority = {"boss_review": 0, "defer": 1, "needs_evidence": 2, "not_ready": 3, "pay": 4}
    assessments.sort(key=lambda pair: (priority[pair[0].decision], -(pair[0].gap_increase or 0), pair[1].planned_date, pair[1].expense_no))
    db.commit()
    return {"data": {"asOfDate": asOfDate.isoformat(), "batchId": str(batch.id), "items": [serialize_assessment(item, expense) for item, expense in assessments[:3]]}}


@router.post("/payment-recommendations/{assessment_id}/ai-explanation")
def generate_payment_explanation(assessment_id: UUID, db: Session = Depends(get_db)):
    item, expense, cached = ensure_payment_assessment_explanation(db, assessment_id)
    return {"data": {"id": str(item.id), "aiExplanation": item.ai_explanation, "cached": cached, "item": serialize_assessment(item, expense)}}


@router.get("/decision-events")
def list_decision_events(asOfDate: date = Query(default_factory=date.today), status: str = "pending", page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    refresh_decision_events(db, asOfDate)
    db.commit()
    filters = [DecisionEvent.status == status]
    items = db.scalars(select(DecisionEvent).where(*filters).order_by(DecisionEvent.risk_level.desc(), DecisionEvent.impact_date, DecisionEvent.impact_amount.desc(), DecisionEvent.created_at).offset((page - 1) * pageSize).limit(pageSize)).all()
    all_items = db.scalars(select(DecisionEvent).where(*filters)).all()
    total = len(all_items)
    return {"data": [serialize_event(item) for item in items], "pagination": {"page": page, "pageSize": pageSize, "total": total, "totalPages": (total + pageSize - 1) // pageSize}}


@router.get("/decision-events/{event_id}")
def get_decision_event(event_id: UUID, db: Session = Depends(get_db)):
    item = db.get(DecisionEvent, event_id)
    if not item:
        from app.core.exceptions import AppError
        raise AppError("decision_event_not_found", "拍板事件不存在", 404)
    return {"data": serialize_event(item)}


class DecisionBody(BaseModel):
    option: str
    note: str | None = Field(None, max_length=1000)
    payload: dict | None = None
    version: int


@router.post("/decision-events/{event_id}:decide")
def submit_decision(event_id: UUID, body: DecisionBody, db: Session = Depends(get_db)):
    return {"data": serialize_event(decide_event(db, event_id, body.option, body.note, body.payload, body.version))}
