import json
from collections.abc import AsyncIterator
from decimal import Decimal

from sqlalchemy.orm import Session

from app.modules.ai.client import ai_available, get_chat_model
from app.modules.ai.prompts import DECISION_EXPLANATION_PROMPT
from app.modules.decision.models import DecisionEvent
from app.modules.decision.service import serialize_event


def _money_text(value: str) -> str:
    amount = Decimal(value)
    return f"{amount / Decimal('10000'):.2f} 万元" if abs(amount) >= 10000 else f"{amount:.2f} 元"


def fallback_explanation(event: DecisionEvent) -> str:
    item = serialize_event(event)
    event_kind = "付款事项" if item["eventType"] == "payment_assessment" else "回款风险"
    impact_date = item["impactDate"] or "待确认"
    options = "、".join(item["allowedOptions"]) if item["allowedOptions"] else "系统暂无可选处理方式"
    return (
        f"一句话结论：该{event_kind}已达到老板介入条件。\n\n"
        f"为什么需要老板拍板：规则引擎命中了 {len(item['reasonCodes'])} 项升级条件，"
        "现有规则无法自动代替老板选择处理方案。\n\n"
        f"影响：涉及金额 {_money_text(item['impactAmount'])}，影响日期为 {impact_date}。\n\n"
        f"当前可以选择的处理方式：{options}。"
    )


def event_prompt_payload(event: DecisionEvent) -> dict:
    item = serialize_event(event)
    return {
        "title": item["title"],
        "eventType": item["eventType"],
        "riskLevel": item["riskLevel"],
        "impactAmount": item["impactAmount"],
        "impactDate": item["impactDate"],
        "ownerName": item["ownerName"],
        "reasonCodes": item["reasonCodes"],
        "evidence": item["evidence"],
        "allowedOptions": item["allowedOptions"],
        "ruleVersion": item["ruleVersion"],
    }


async def stream_event_explanation(db: Session, event_id) -> AsyncIterator[tuple[str, bool]]:
    event = db.get(DecisionEvent, event_id)
    if not event:
        from app.core.exceptions import AppError

        raise AppError("decision_event_not_found", "拍板事件不存在", 404)

    if not ai_available():
        yield fallback_explanation(event), True
        return

    prompt = DECISION_EXPLANATION_PROMPT.invoke(
        {"event_json": json.dumps(event_prompt_payload(event), ensure_ascii=False, indent=2)}
    )
    emitted = False
    try:
        async for chunk in get_chat_model().astream(prompt):
            content = chunk.content
            if isinstance(content, str) and content:
                emitted = True
                yield content, False
    except Exception:
        if not emitted:
            yield fallback_explanation(event), True
