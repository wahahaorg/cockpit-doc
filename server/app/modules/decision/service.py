import json
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.modules.ai.client import ai_available, get_chat_model
from app.modules.ai.prompts import PAYMENT_ASSESSMENT_EXPLANATION_PROMPT
from app.modules.cashflow.calculators import CashflowEntry, build_daily_forecast, curve_summary
from app.modules.cashflow.forecast import forecast_inputs, money
from app.modules.cashflow.models import PlannedExpense
from app.modules.dashboard.service import receivable_facts
from app.modules.data_import.models import ImportBatch
from app.modules.data_import.service import current_batch
from app.modules.decision.models import DecisionEvent, PaymentAssessment


ZERO = Decimal("0.00")
RECEIVABLE_OPTIONS = ["escalate_collection", "continue_followup", "adjust_expected_date", "reassign_owner"]
PAYMENT_OPTIONS = ["pay_and_fund", "defer_payment", "adjust_other_expenses", "prioritize_collection"]
PAYMENT_ACTIONS = {
    "pay": ["按计划付款"],
    "defer": ["暂缓至预计回款到账后", "调整其他可延后支出", "由老板确认接受短期缺口"],
    "boss_review": ["支付并补充资金", "调整其他支出", "优先催收回款", "老板确认接受短期缺口"],
    "not_ready": ["完成审批后重新评估"],
    "needs_evidence": ["补充付款依据后重新评估"],
}


def _replace_amount(curve, start_date: date, amount: Decimal):
    return [
        point.__class__(point.flow_date, point.inflow, point.outflow + (amount if point.flow_date == start_date else ZERO), point.net_flow - (amount if point.flow_date == start_date else ZERO), point.balance - (amount if point.flow_date >= start_date else ZERO))
        for point in curve
    ]


def _assessment_values(expense: PlannedExpense, queue_order: int | None, decision: str, reasons: list[str], before: dict | None = None, after: dict | None = None) -> dict:
    gap_before = before["maximum_gap"] if before else None
    gap_after = after["maximum_gap"] if after else None
    return {
        "queue_order": queue_order,
        "eligibility_result": "eligible" if decision in {"pay", "defer", "boss_review"} else decision,
        "decision": decision,
        "reason_codes": reasons,
        "min_balance_before": before["minimum_balance"] if before else None,
        "min_balance_after": after["minimum_balance"] if after else None,
        "gap_before": gap_before,
        "gap_after": gap_after,
        "gap_increase": max(gap_after - gap_before, ZERO) if gap_before is not None and gap_after is not None else None,
        "gap_date": after["gap_date"] if after else None,
        "recovery_date": after["recovery_date"] if after else None,
        "evidence_snapshot": {
            "expenseNo": expense.expense_no,
            "expenseName": expense.expense_name,
            "plannedDate": expense.planned_date.isoformat(),
            "plannedAmount": money(Decimal(expense.planned_amount)),
            "rigidity": expense.rigidity,
            "approvalStatus": expense.approval_status,
            "gapBefore": money(gap_before) if gap_before is not None else None,
            "gapAfter": money(gap_after) if gap_after is not None else None,
        },
    }


def _payment_explanation_payload(expense: PlannedExpense, values: dict) -> dict:
    evidence = values["evidence_snapshot"]
    return {
        "expenseNo": expense.expense_no,
        "expenseName": expense.expense_name,
        "amount": evidence.get("plannedAmount"),
        "plannedDate": evidence.get("plannedDate"),
        "rigidity": expense.rigidity,
        "approvalStatus": expense.approval_status,
        "decision": values["decision"],
        "reasonCodes": values["reason_codes"],
        "gapBefore": money(values["gap_before"]) if values["gap_before"] is not None else None,
        "gapAfter": money(values["gap_after"]) if values["gap_after"] is not None else None,
        "gapIncrease": money(values["gap_increase"]) if values["gap_increase"] is not None else None,
        "gapDate": values["gap_date"].isoformat() if values["gap_date"] else None,
        "recoveryDate": values["recovery_date"].isoformat() if values["recovery_date"] else None,
        "allowedActions": PAYMENT_ACTIONS.get(values["decision"], []),
    }


def _fallback_payment_explanation(payload: dict) -> str:
    decision_label = {
        "pay": "建议可付",
        "defer": "建议暂缓",
        "boss_review": "建议老板拍板",
        "not_ready": "暂未就绪",
        "needs_evidence": "需要补充依据",
    }.get(payload["decision"], payload["decision"])
    actions = "、".join(payload["allowedActions"]) if payload["allowedActions"] else "系统暂无可选动作"
    if payload["decision"] == "pay":
        reason = "该付款加入现金流预测后，未扩大最大现金缺口。"
    elif payload["decision"] == "defer":
        reason = "该付款会扩大现金缺口，且属于可延期支出。"
    elif payload["decision"] == "boss_review":
        reason = "该付款会扩大现金缺口，但属于刚性支出，系统不能自动替老板决定。"
    elif payload["decision"] == "not_ready":
        reason = "该付款审批尚未完成，暂不进入正式付款试算。"
    else:
        reason = "该付款需要补充资料后再重新评估。"
    impact = (
        f"支付前最大缺口 {payload['gapBefore']}，支付后最大缺口 {payload['gapAfter']}，"
        f"缺口增加 {payload['gapIncrease']}，缺口日期 {payload['gapDate'] or '系统暂无该信息'}。"
        if payload.get("gapAfter") is not None
        else "该付款当前没有完整的现金流试算结果。"
    )
    return (
        f"一句话结论：{payload['expenseName']}当前{decision_label}。\n\n"
        f"建议原因：{reason}\n\n"
        f"对现金流的影响：{impact}\n\n"
        f"可选动作：{actions}。"
    )


def _payment_explanation(expense: PlannedExpense, values: dict) -> str:
    payload = _payment_explanation_payload(expense, values)
    if not ai_available():
        return _fallback_payment_explanation(payload)
    try:
        prompt = PAYMENT_ASSESSMENT_EXPLANATION_PROMPT.invoke(
            {"assessment_json": json.dumps(payload, ensure_ascii=False, indent=2)}
        )
        response = get_chat_model().invoke(prompt)
        content = response.content
        if isinstance(content, str) and content.strip():
            return content.strip()
    except Exception:
        pass
    return _fallback_payment_explanation(payload)


def _upsert_assessment(db: Session, expense: PlannedExpense, as_of: date, batch: ImportBatch, values: dict) -> PaymentAssessment:
    rule_version = get_settings().rule_version
    item = db.scalar(select(PaymentAssessment).where(
        PaymentAssessment.planned_expense_id == expense.id,
        PaymentAssessment.as_of_date == as_of,
        PaymentAssessment.import_batch_id == batch.id,
        PaymentAssessment.rule_version == rule_version,
    ))
    if not item:
        item = PaymentAssessment(planned_expense_id=expense.id, as_of_date=as_of, import_batch_id=batch.id, rule_version=rule_version, **values)
        db.add(item)
    else:
        changed = any(getattr(item, key) != value for key, value in values.items())
        for key, value in values.items():
            setattr(item, key, value)
        if changed:
            item.ai_explanation = None
    db.flush()
    return item


def refresh_payment_assessments(db: Session, as_of: date, batch: ImportBatch | None = None) -> list[tuple[PaymentAssessment, PlannedExpense]]:
    batch = batch or current_batch(db)
    opening, inflows, outflows, _, _ = forecast_inputs(db, as_of, batch)
    expenses = db.scalars(select(PlannedExpense).where(
        PlannedExpense.import_batch_id == batch.id,
        PlannedExpense.status == "active",
        PlannedExpense.approval_status != "cancelled",
    )).all()
    approved = sorted(
        [item for item in expenses if item.approval_status == "approved"],
        key=lambda item: (0 if item.rigidity == "rigid" else 1, 0 if item.planned_date < as_of else 1, item.planned_date, item.expense_no),
    )
    approved_ids = {item.id for item in approved}
    base_outflows = [entry for entry in outflows if entry.source_id not in approved_ids]
    current_curve = build_daily_forecast(as_of, opening, inflows, base_outflows)
    results: list[tuple[PaymentAssessment, PlannedExpense]] = []

    for expense in expenses:
        if expense.approval_status in {"planned", "pending"}:
            values = _assessment_values(expense, None, "not_ready", ["approval_not_completed"])
            results.append((_upsert_assessment(db, expense, as_of, batch, values), expense))

    for queue_order, expense in enumerate(approved, start=1):
        before = curve_summary(current_curve)
        effective_payment_date = max(expense.planned_date, as_of)
        candidate = _replace_amount(current_curve, effective_payment_date, Decimal(expense.planned_amount))
        after = curve_summary(candidate)
        gap_increased = after["maximum_gap"] > before["maximum_gap"]
        if not gap_increased:
            decision, reasons = "pay", ["cash_gap_not_increased"]
            current_curve = candidate
        elif expense.rigidity == "rigid":
            decision, reasons = "boss_review", ["rigid_expense", "cash_gap_increased"]
            current_curve = candidate
        else:
            decision, reasons = "defer", ["deferrable_expense", "cash_gap_increased"]
        values = _assessment_values(expense, queue_order, decision, reasons, before, after)
        results.append((_upsert_assessment(db, expense, as_of, batch, values), expense))
    return results


def _pending_event(db: Session, business_key: str) -> DecisionEvent | None:
    return db.scalar(select(DecisionEvent).where(DecisionEvent.business_key == business_key, DecisionEvent.status == "pending"))


def _next_cycle(db: Session, business_key: str) -> int:
    return (db.scalar(select(func.max(DecisionEvent.risk_cycle_no)).where(DecisionEvent.business_key == business_key)) or 0) + 1


def _upsert_event(db: Session, business_key: str, event_type: str, source_id: UUID, title: str, amount: Decimal, impact_date: date | None, owner_code: str | None, owner_name: str | None, reasons: list[str], evidence: dict, options: list[str], batch: ImportBatch) -> DecisionEvent:
    event = _pending_event(db, business_key)
    if not event:
        latest = db.scalar(select(DecisionEvent).where(DecisionEvent.business_key == business_key).order_by(DecisionEvent.risk_cycle_no.desc()).limit(1))
        # A decision resolves the current escalation request. Continued exposure updates
        # its source evidence but must not immediately open another event cycle.
        if latest and latest.status == "decided" and not latest.closed_reason:
            return latest
        cycle = _next_cycle(db, business_key)
        event = DecisionEvent(
            business_key=business_key,
            event_key=f"{business_key}:{cycle}",
            risk_cycle_no=cycle,
            event_type=event_type,
            source_id=source_id,
            title=title,
            risk_level="red",
            impact_amount=amount,
            impact_date=impact_date,
            owner_code=owner_code,
            owner_name=owner_name,
            reason_codes=reasons,
            evidence_snapshot=evidence,
            allowed_options=options,
            import_batch_id=batch.id,
            rule_version=get_settings().rule_version,
        )
        db.add(event)
    else:
        event.title = title
        event.impact_amount = amount
        event.impact_date = impact_date
        event.owner_code = owner_code
        event.owner_name = owner_name
        event.reason_codes = reasons
        event.evidence_snapshot = evidence
        event.allowed_options = options
        event.import_batch_id = batch.id
        event.rule_version = get_settings().rule_version
        event.version += 1
    db.flush()
    return event


def refresh_decision_events(db: Session, as_of: date, batch: ImportBatch | None = None) -> list[DecisionEvent]:
    batch = batch or current_batch(db)
    active_keys: set[str] = set()
    for receivable, customer, fact in receivable_facts(db, batch.id):
        if fact.risk_level(as_of) != "red":
            continue
        key = f"receivable_risk:{receivable.receivable_no}"
        active_keys.add(key)
        reasons = []
        if fact.overdue_days(as_of) >= 30:
            reasons.append("overdue_30_days")
        if fact.overdue_days(as_of) > 0 and fact.outstanding >= Decimal("1000000"):
            reasons.append("overdue_large_amount")
        _upsert_event(db, key, "receivable_risk", receivable.id, f"{customer.customer_name}回款风险需拍板", fact.outstanding, receivable.agreed_due_date, receivable.owner_code, receivable.owner_name, reasons, {
            "receivableNo": receivable.receivable_no,
            "customerName": customer.customer_name,
            "receivableAmount": money(fact.amount),
            "collectedAmount": money(fact.collected),
            "outstandingAmount": money(fact.outstanding),
            "agreedDueDate": receivable.agreed_due_date.isoformat(),
            "overdueDays": fact.overdue_days(as_of),
        }, RECEIVABLE_OPTIONS, batch)

    assessments = refresh_payment_assessments(db, as_of, batch)
    for assessment, expense in assessments:
        if assessment.decision != "boss_review":
            continue
        key = f"payment_assessment:{expense.expense_no}"
        active_keys.add(key)
        _upsert_event(db, key, "payment_assessment", assessment.id, f"{expense.expense_name}付款需拍板", Decimal(expense.planned_amount), assessment.gap_date, expense.owner_code, expense.owner_name, assessment.reason_codes, assessment.evidence_snapshot, PAYMENT_OPTIONS, batch)

    open_cycles = db.scalars(select(DecisionEvent).where(DecisionEvent.closed_reason.is_(None))).all()
    for event in open_cycles:
        if event.business_key not in active_keys:
            if event.status == "pending":
                event.status = "closed"
            event.closed_reason = "source_risk_resolved"
            event.version += 1
    db.flush()
    return db.scalars(select(DecisionEvent).where(DecisionEvent.status == "pending")).all()


def serialize_assessment(item: PaymentAssessment, expense: PlannedExpense) -> dict:
    return {
        "id": str(item.id),
        "plannedExpenseId": str(expense.id),
        "expenseNo": expense.expense_no,
        "expenseName": expense.expense_name,
        "plannedDate": expense.planned_date.isoformat(),
        "plannedAmount": money(Decimal(expense.planned_amount)),
        "rigidity": expense.rigidity,
        "approvalStatus": expense.approval_status,
        "ownerCode": expense.owner_code,
        "ownerName": expense.owner_name,
        "queueOrder": item.queue_order,
        "eligibilityResult": item.eligibility_result,
        "decision": item.decision,
        "reasonCodes": item.reason_codes,
        "gapBefore": money(item.gap_before) if item.gap_before is not None else None,
        "gapAfter": money(item.gap_after) if item.gap_after is not None else None,
        "gapIncrease": money(item.gap_increase) if item.gap_increase is not None else None,
        "gapDate": item.gap_date.isoformat() if item.gap_date else None,
        "recoveryDate": item.recovery_date.isoformat() if item.recovery_date else None,
        "evidence": item.evidence_snapshot,
        "aiExplanation": item.ai_explanation,
    }


def ensure_payment_assessment_explanation(db: Session, assessment_id: UUID) -> tuple[PaymentAssessment, PlannedExpense, bool]:
    item = db.get(PaymentAssessment, assessment_id)
    if not item:
        raise AppError("payment_assessment_not_found", "付款建议不存在", 404)
    expense = db.get(PlannedExpense, item.planned_expense_id)
    if not expense:
        raise AppError("planned_expense_not_found", "计划支出不存在", 404)
    if item.ai_explanation:
        return item, expense, True
    values = {
        "decision": item.decision,
        "reason_codes": item.reason_codes,
        "gap_before": item.gap_before,
        "gap_after": item.gap_after,
        "gap_increase": item.gap_increase,
        "gap_date": item.gap_date,
        "recovery_date": item.recovery_date,
        "evidence_snapshot": item.evidence_snapshot,
    }
    item.ai_explanation = _payment_explanation(expense, values)
    db.commit()
    return item, expense, False


def serialize_event(item: DecisionEvent) -> dict:
    return {
        "id": str(item.id), "eventType": item.event_type, "title": item.title, "riskLevel": item.risk_level,
        "impactAmount": money(Decimal(item.impact_amount)), "impactDate": item.impact_date.isoformat() if item.impact_date else None,
        "ownerCode": item.owner_code, "ownerName": item.owner_name, "reasonCodes": item.reason_codes,
        "evidence": item.evidence_snapshot, "allowedOptions": item.allowed_options, "status": item.status,
        "selectedOption": item.selected_option, "decisionNote": item.decision_note, "version": item.version,
        "batchId": str(item.import_batch_id), "ruleVersion": item.rule_version,
    }


def decide_event(db: Session, event_id: UUID, option: str, note: str | None, payload: dict | None, version: int) -> DecisionEvent:
    event = db.get(DecisionEvent, event_id)
    if not event:
        raise AppError("decision_event_not_found", "拍板事件不存在", 404)
    if event.version != version:
        raise AppError("version_conflict", "事件版本已变化", 409)
    if event.status != "pending":
        raise AppError("decision_event_not_pending", "事件已处理或关闭", 409)
    if option not in event.allowed_options:
        raise AppError("decision_option_not_allowed", "该事件不允许此处理选项", 422)
    required = {"continue_followup": "newDeadline", "adjust_expected_date": "newExpectedDate", "reassign_owner": "newOwnerCode", "pay_and_fund": "fundingNote", "defer_payment": "newPlannedDate"}
    required_field = required.get(option)
    if required_field and not (payload or {}).get(required_field):
        raise AppError("decision_input_required", f"处理选项缺少必填字段 {required_field}", 422)
    event.status = "decided"
    event.selected_option = option
    event.decision_note = note
    event.decision_payload = payload or {}
    event.decided_by = "admin"
    event.decided_at = datetime.now(timezone.utc)
    event.version += 1
    db.commit()
    return event
