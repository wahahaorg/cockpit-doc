import json
import logging
import re
import time
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class SettlementAiRecord(BaseModel):
    sourcePages: list[int] = Field(default_factory=list)
    customerName: str | None = None
    settlementPeriod: str | None = None
    settlementAmount: float | None = None
    confidence: float = Field(ge=0, le=1)
    missingFields: list[str] = Field(default_factory=list)


class SettlementAiResponse(BaseModel):
    records: list[SettlementAiRecord] = Field(default_factory=list)


class SettlementPageGroup(BaseModel):
    groupId: int = Field(ge=1)
    sourcePages: list[int] = Field(min_length=1)
    expectedRecords: int = Field(ge=1)


class SettlementGroupingResponse(BaseModel):
    groups: list[SettlementPageGroup] = Field(min_length=1)


_PDF_PAGE_MARKER = re.compile(r"(?m)^# 第\s*(\d+)\s*页\s*$")


def _split_page_marked_text(text: str) -> list[tuple[int, str]]:
    matches = list(_PDF_PAGE_MARKER.finditer(text))
    if not matches:
        return []
    pages = []
    prefix = text[:matches[0].start()].strip()
    for index, match in enumerate(matches):
        page_number = int(match.group(1))
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[match.end():end].strip()
        if index == 0 and prefix:
            body = f"{prefix}\n{body}".strip()
        pages.append((page_number, f"# 第 {page_number} 页\n{body}".strip()))
    return pages


def _validate_settlement_groups(groups: list[dict[str, Any]], page_numbers: list[int]) -> list[dict[str, Any]]:
    if not groups:
        raise ValueError("AI 未返回结算单页面分组")
    normalized = []
    seen_group_ids: set[int] = set()
    assigned_pages: list[int] = []
    valid_pages = set(page_numbers)
    for group in groups:
        group_id = int(group.get("groupId") or 0)
        source_pages = sorted({int(page) for page in group.get("sourcePages") or []})
        expected_records = int(group.get("expectedRecords") or 0)
        if group_id <= 0 or group_id in seen_group_ids:
            raise ValueError("结算单页面分组 ID 无效或重复")
        if not source_pages or any(page not in valid_pages for page in source_pages):
            raise ValueError(f"第 {group_id} 组包含无效页码")
        if any(current != previous + 1 for previous, current in zip(source_pages, source_pages[1:])):
            raise ValueError(f"第 {group_id} 组页码不连续")
        if expected_records <= 0:
            raise ValueError(f"第 {group_id} 组预期结算单数量无效")
        seen_group_ids.add(group_id)
        assigned_pages.extend(source_pages)
        normalized.append({"groupId": group_id, "sourcePages": source_pages, "expectedRecords": expected_records})
    if len(assigned_pages) != len(set(assigned_pages)):
        raise ValueError("结算单页面分组存在重复页码")
    if set(assigned_pages) != valid_pages:
        raise ValueError("结算单页面分组存在遗漏页码")
    return sorted(normalized, key=lambda item: item["sourcePages"][0])


def _settlement_grouping_prompt(text: str, page_count: int) -> str:
    return (
        "你是结算单文档分组助手。只判断以下多页 OCR 文本包含几张独立结算单以及页面如何分组，不要抽取公司、周期或金额。\n"
        f"文档共 {page_count} 页，文本中的“# 第 N 页”是页码边界。\n"
        "同一张结算单可能跨多页；不同结算单也可能具有相同标题、客户和月份。请根据内容是否重新开始一套完整表格、是否出现独立合计以及上下文连续性判断。\n"
        "每个页码必须且只能出现在一个 group 中，不得重复或遗漏；同组页码必须连续。\n"
        "如果同一页或同一页面组内包含多张独立结算单，用 expectedRecords 表示数量，不要重复创建包含相同页码的 group。\n"
        "输出 groups，每组包含从 1 开始的 groupId、sourcePages 页码数组和 expectedRecords。\n"
        f"OCR 文本：\n{text[:24000]}"
    )


def _group_settlement_pages_with_ai(text: str, file_name: str, page_count: int) -> dict[str, Any]:
    settings = get_settings()
    tried_at = datetime.now().isoformat()
    content: str | None = None
    try:
        from app.modules.ai.client import ai_available, get_chat_model

        if not ai_available():
            return {"status": "failed", "groups": [], "model": settings.ai_model, "error": "AI 服务未启用或当前不可用", "triedAt": tried_at}
        prompt = _settlement_grouping_prompt(text, page_count)
        logger.info("income_reconciliation_ai_grouping_started file=%s model=%s pages=%d", file_name, settings.ai_model, page_count)
        response = get_chat_model().with_structured_output(
            SettlementGroupingResponse,
            method="json_schema",
            include_raw=True,
        ).invoke(prompt)
        raw_message = response.get("raw") if isinstance(response, dict) else None
        raw_content = getattr(raw_message, "content", None)
        if isinstance(raw_content, str):
            content = raw_content
        elif raw_content is not None:
            content = json.dumps(raw_content, ensure_ascii=False)
        parsed_output = response.get("parsed") if isinstance(response, dict) else None
        parsing_error = response.get("parsing_error") if isinstance(response, dict) else None
        parsed = parsed_output.model_dump(mode="json") if isinstance(parsed_output, BaseModel) else parsed_output
        if not parsing_error and isinstance(parsed, dict) and isinstance(parsed.get("groups"), list):
            parsed.update({"status": "success", "model": settings.ai_model, "rawResponse": content, "triedAt": tried_at})
            return parsed
        error = str(parsing_error) if parsing_error else "AI 返回内容不符合结算单分组结构"
        return {"status": "failed", "groups": [], "model": settings.ai_model, "error": error, "rawResponse": content, "triedAt": tried_at}
    except Exception as exc:
        logger.exception("income_reconciliation_ai_grouping_failed file=%s model=%s", file_name, settings.ai_model)
        return {"status": "failed", "groups": [], "model": settings.ai_model, "error": str(exc), "rawResponse": content, "triedAt": tried_at}


def _extract_settlement_with_ai(text: str, file_name: str) -> dict[str, Any]:
    pages = _split_page_marked_text(text)
    if len(pages) < 2:
        return _extract_settlement_chunk_with_ai(text, file_name)

    grouping = _group_settlement_pages_with_ai(text, file_name, len(pages))
    if grouping.get("status") == "failed":
        return {
            "status": "failed",
            "records": [],
            "model": grouping.get("model"),
            "error": f"结算单页面分组失败：{grouping.get('error') or '未知错误'}",
            "rawResponse": grouping.get("rawResponse"),
            "triedAt": grouping.get("triedAt"),
        }

    try:
        groups = _validate_settlement_groups(grouping.get("groups") or [], [page_number for page_number, _ in pages])
    except ValueError as exc:
        return {
            "status": "failed",
            "records": [],
            "model": grouping.get("model"),
            "error": f"结算单页面分组无效：{exc}",
            "rawResponse": grouping.get("rawResponse"),
            "triedAt": grouping.get("triedAt"),
        }

    page_text = dict(pages)
    records: list[dict[str, Any]] = []
    raw_sections = [f"[页面分组]\n{grouping.get('rawResponse') or json.dumps({'groups': groups}, ensure_ascii=False)}"]
    for group in groups:
        group_text = "\n\n".join(page_text[page] for page in group["sourcePages"])
        result = _extract_settlement_chunk_with_ai(
            group_text,
            f"{file_name}#group-{group['groupId']}",
            expected_records=group["expectedRecords"],
        )
        raw_sections.append(f"[分组 {group['groupId']} 字段抽取]\n{result.get('rawResponse') or ''}")
        if result.get("status") == "failed":
            return {
                "status": "failed",
                "records": [],
                "model": result.get("model") or grouping.get("model"),
                "error": f"第 {group['groupId']} 组 AI 抽取失败：{result.get('error') or '未知错误'}",
                "rawResponse": "\n\n".join(raw_sections),
                "triedAt": result.get("triedAt") or grouping.get("triedAt"),
            }
        group_records = result.get("records") or []
        if len(group_records) != group["expectedRecords"]:
            return {
                "status": "failed",
                "records": [],
                "model": result.get("model") or grouping.get("model"),
                "error": f"第 {group['groupId']} 组预期 {group['expectedRecords']} 张结算单，实际抽取 {len(group_records)} 张",
                "rawResponse": "\n\n".join(raw_sections),
                "triedAt": result.get("triedAt") or grouping.get("triedAt"),
            }
        for record in group_records:
            record["sourcePages"] = group["sourcePages"]
            records.append(record)

    return {
        "status": "success",
        "records": records,
        "groups": groups,
        "model": grouping.get("model"),
        "rawResponse": "\n\n".join(raw_sections),
        "triedAt": grouping.get("triedAt"),
    }


def _extract_settlement_chunk_with_ai(text: str, file_name: str, expected_records: int | None = None) -> dict[str, Any]:
    settings = get_settings()
    prompt = _settlement_ai_prompt(text, expected_records=expected_records)
    tried_at = datetime.now().isoformat()
    content: str | None = None
    try:
        from app.modules.ai.client import ai_available, get_chat_model

        ai_enabled = ai_available()
        if ai_enabled:
            started_at = time.monotonic()
            logger.info(
                "income_reconciliation_ai_call_started file=%s model=%s base_url=%s prompt_chars=%d text_chars=%d timeout_seconds=%d",
                file_name,
                settings.ai_model,
                settings.ollama_base_url,
                len(prompt),
                len(text),
                settings.ai_timeout_seconds,
            )
            structured_model = get_chat_model().with_structured_output(
                SettlementAiResponse,
                method="json_schema",
                include_raw=True,
            )
            response = structured_model.invoke(prompt)
            raw_message = response.get("raw") if isinstance(response, dict) else None
            raw_content = getattr(raw_message, "content", None)
            if isinstance(raw_content, str):
                content = raw_content
            elif raw_content is not None:
                content = json.dumps(raw_content, ensure_ascii=False)
            parsed_output = response.get("parsed") if isinstance(response, dict) else None
            parsing_error = response.get("parsing_error") if isinstance(response, dict) else None
            parsed = parsed_output.model_dump(mode="json") if isinstance(parsed_output, BaseModel) else parsed_output
            if not parsing_error and isinstance(parsed, dict) and isinstance(parsed.get("records"), list):
                parsed.update({"rawResponse": content, "model": settings.ai_model, "status": "success", "triedAt": tried_at})
                logger.info(
                    "income_reconciliation_ai_call_finished file=%s model=%s records=%d response_chars=%d elapsed_ms=%d",
                    file_name,
                    settings.ai_model,
                    len(parsed["records"]),
                    len(content or ""),
                    int((time.monotonic() - started_at) * 1000),
                )
                return parsed
            logger.warning("income_reconciliation_ai_invalid_json file=%s model=%s response_chars=%d", file_name, settings.ai_model, len(content or ""))
            error = str(parsing_error) if parsing_error else "AI 返回内容不符合结算单结构"
            return {"status": "failed", "records": [], "model": settings.ai_model, "error": error, "rawResponse": content, "triedAt": tried_at}
        logger.info("income_reconciliation_ai_skipped file=%s ai_enabled=%s", file_name, ai_enabled)
        return {"status": "failed", "records": [], "model": settings.ai_model, "error": "AI 服务未启用或当前不可用", "triedAt": tried_at}
    except Exception as exc:
        logger.exception("income_reconciliation_ai_call_failed file=%s model=%s base_url=%s", file_name, settings.ai_model, settings.ollama_base_url)
        return {"status": "failed", "records": [], "model": settings.ai_model, "error": str(exc), "rawResponse": content, "triedAt": tried_at}


def _settlement_ai_prompt(text: str, expected_records: int | None = None) -> str:
    expected_rule = (
        f"本次输入已由页面分组节点判定包含 {expected_records} 张独立结算单，records 必须输出恰好 {expected_records} 条。\n"
        if expected_records is not None
        else ""
    )
    return (
        "你是财务结算单解析助手。请从结算单 OCR/文本中抽取结构化字段，只输出 JSON，不要解释。\n"
        f"{expected_rule}"
        "目标字段：sourcePages=本条结算单内容对应的 PDF 页码数组；customerName=需要向我方付款结算的客户方/甲方公司名称，用于匹配发票购买方和收支往来单位；settlementPeriod=结算周期 YYYY-MM；settlementAmount=本结算单最终应结算金额；confidence=0到1；missingFields=缺失字段数组。\n"
        "抽取规则：\n"
        "1. 先从全文识别所有出现的完整公司或机构名称，包括称谓、正文、开票信息和盖章位置中的名称；不要仅根据甲方、乙方、技术服务方、付款方或收款方等角色称谓直接确定 customerName。如果某一行已经包含以“有限公司、股份有限公司、分公司”等结尾的完整公司名称，应原样提取该行中的公司名称，不要把它前后相邻的孤立短文本、页眉噪声或印章残字拼接进公司名。\n"
        "2. 从公司候选中排除名称里包含“杭州长生保”的我方公司，再从剩余候选中选择本结算单对应的客户公司作为 customerName。排除后没有可靠候选时填 null，不要使用文件名补全或编造公司名称。\n"
        "3. settlementAmount 表示本结算单最终应结算的总金额。OCR 文本可能存在换行错乱、列顺序丢失、标题与数值分离，请结合上下文恢复字段与数值的对应关系。\n"
        "4. 识别金额候选时，优先级依次为：明确标注的合计/总计/应结算金额，其次是可通过数量乘以单价验证的总价，再次是服务费用或含税总额，最后才是其他金额。\n"
        "5. 当存在调用次数、数量、单价、总价等字段时，请使用数量乘以单价对总价进行交叉验证；OCR 把小数拆成多行时，应先按上下文还原小数，再计算验证。\n"
        "6. 合计行出现多个数字时，必须结合表头和列顺序判断每个数字的含义。若表头包含调用次数/数量、单价、总价/金额，则调用次数或数量列的合计不是结算金额，应选择总价或金额列对应的合计。还应与正文前部的金额汇总或应结算金额交叉验证。\n"
        "7. 不要仅因为金额出现在项目行附近就排除它。如果该金额同时满足合计标签、总价字段或数量乘以单价的计算关系，应将其作为 settlementAmount。不要把调用次数、数量或单价本身当作结算金额。\n"
        "8. 如果存在多个金额候选，请在内部完成候选比较、列语义判断和算术核验后选择证据最充分的一项。不要简单选择合计标签后的第一个数字，也不要简单选择 OCR 文本中最后出现的数字。\n"
        "9. settlementPeriod 只从正文明确的结算周期提取。\n"
        "10. 不要编造缺失信息；找不到的字段填 null。金额输出数字，不要带人民币、元、逗号或其他单位。\n"
        "11. 文本中的“# 第 N 页”是 PDF 页码边界。根据页码、重复标题、重复表头和独立合计判断结算单边界；一张结算单可以跨多页。每张独立结算单分别输出一条 records，并填写对应 sourcePages；不要把不同结算单的金额相加。如果只是同一张结算单的多行服务项目，只输出一条。\n"
        "只输出最终 JSON，不要输出分析过程。输出格式：{\"records\":[{\"sourcePages\":[],\"customerName\":null,\"settlementPeriod\":null,\"settlementAmount\":null,\"confidence\":0.0,\"missingFields\":[]}]}\n"
        f"文本：\n{text[:24000]}"
    )
