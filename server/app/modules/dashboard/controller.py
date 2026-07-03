from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.modules.dashboard.service import overview, risks, simulate_expense

router = APIRouter(tags=["dashboard"])


@router.get("/cockpit/overview")
def get_overview(asOfDate: date = Query(default_factory=date.today), db: Session = Depends(get_db)):
    return {"data": overview(db, asOfDate)}


@router.get("/receivable-risks")
def get_risks(asOfDate: date = Query(default_factory=date.today), riskLevel: str | None = None, ownerCode: str | None = None, db: Session = Depends(get_db)):
    data = risks(db, asOfDate, riskLevel, ownerCode)
    return {"data": data, "pagination": {"page": 1, "pageSize": len(data), "total": len(data), "totalPages": 1 if data else 0}}


class SimulationBody(BaseModel):
    asOfDate: date
    amount: Decimal = Field(gt=0)
    plannedDate: date
    category: str
    rigidity: str


@router.post("/expense-simulations")
def expense_simulation(body: SimulationBody, db: Session = Depends(get_db)):
    return {"data": simulate_expense(db, body.asOfDate, body.amount)}

