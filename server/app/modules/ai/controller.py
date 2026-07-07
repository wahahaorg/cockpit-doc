import json
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.modules.ai.service import stream_event_explanation
from app.modules.decision.models import DecisionEvent


router = APIRouter(tags=["ai"])


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.get("/decision-events/{event_id}/ai-explanation:stream")
def explain_decision_event(event_id: UUID, db: Session = Depends(get_db)):
    event = db.get(DecisionEvent, event_id)
    if not event:
        from app.core.exceptions import AppError

        raise AppError("decision_event_not_found", "拍板事件不存在", 404)

    async def generate():
        degraded = False
        async for text, is_degraded in stream_event_explanation(db, event_id):
            degraded = degraded or is_degraded
            yield _sse({"type": "delta", "text": text})
        yield _sse({"type": "done", "degraded": degraded})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
