from app.modules.income_reconciliation.company_name import CompanyMatchRelation, compare_company_names, parse_company_name
import json

from app.modules.income_reconciliation import service
from app.modules.income_reconciliation.service import _reconcile


def _invoice(name: str, amount: float, invoice_no: str = "INV-1") -> dict:
    return {"customerName": name, "invoiceAmount": amount, "invoiceNo": invoice_no, "isEffective": True}


def _cashflow(name: str, amount: float) -> dict:
    return {"customerName": name, "receivedAmount": amount}


def _settlement(name: str, amount: float, file_id: str = "SET-1") -> dict:
    return {"customerName": name, "settlementAmount": amount, "fileId": file_id, "sourceFile": f"{file_id}.pdf"}


def test_company_name_matches_head_office_and_branch():
    parsed = parse_company_name("紫金保险销售有限公司上海分公司")

    assert parsed.main_entity == "紫金保险销售有限公司"
    assert parsed.branch == "上海分公司"
    assert compare_company_names("紫金保险销售有限公司", "紫金保险销售有限公司上海分公司") == CompanyMatchRelation.SAME_MAIN_ENTITY
    assert compare_company_names("紫金保险销售有限公司杭州分公司", "紫金保险销售有限公司上海分公司") == CompanyMatchRelation.SAME_MAIN_ENTITY


def test_company_name_does_not_fuzzily_merge_different_entities():
    assert compare_company_names("紫金保险销售有限公司", "紫金财产保险股份有限公司") == CompanyMatchRelation.DIFFERENT
    assert compare_company_names("中驰浙江分", "中驰保险代理有限公司浙江分公司") == CompanyMatchRelation.DIFFERENT


def test_reconcile_matches_amount_then_main_entity():
    result = _reconcile(
        [_invoice("紫金保险销售有限公司上海分公司", 1000)],
        [_cashflow("紫金保险销售有限公司", 1000)],
        [_settlement("紫金保险销售有限公司杭州分公司", 1000)],
    )

    item = result["items"][0]
    assert item["status"] == "已确认已到账"
    assert item["cashflowCompanyMatch"] == "same_main_entity"
    assert item["settlementCompanyMatch"] == "same_main_entity"


def test_reconcile_does_not_match_same_name_with_different_amount():
    result = _reconcile(
        [_invoice("甲有限公司", 1000)],
        [_cashflow("甲有限公司", 900)],
        [_settlement("甲有限公司", 1000)],
    )

    assert result["items"][0]["status"] == "已确认未到账"
    assert result["items"][0]["abnormalReason"] == "未找到同金额记录"


def test_reconcile_keeps_ambiguous_same_amount_candidates_unmatched():
    result = _reconcile(
        [_invoice("甲有限公司", 1000)],
        [_cashflow("甲有限公司", 1000), _cashflow("甲有限公司", 1000)],
        [],
    )

    assert result["items"][0]["status"] == "已确认未到账"
    assert result["items"][0]["abnormalReason"] == "同金额、同主体存在多个候选，需人工确认"
    assert sum(item["status"] == "未确认已到账" for item in result["items"]) == 2


def test_retry_ai_reuses_saved_ocr_and_invalidates_generated_result(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "JOB_ROOT", tmp_path)
    job_id = "job_retry"
    job_dir = tmp_path / job_id
    (job_dir / "parsed").mkdir(parents=True)
    (job_dir / "extracted" / "texts").mkdir(parents=True)
    (job_dir / "extracted" / "ai_extracts").mkdir(parents=True)
    (job_dir / "result").mkdir(parents=True)
    (job_dir / "extracted" / "texts" / "file_settlement_001.txt").write_text("OCR 正文中的甲有限公司，合计 1000 元", encoding="utf-8")
    (job_dir / "result" / "reconciliation.json").write_text("{}", encoding="utf-8")
    (job_dir / "result" / "reconciliation.xlsx").write_bytes(b"old")
    (job_dir / "progress.jsonl").write_text("", encoding="utf-8")
    (job_dir / "job.json").write_text(json.dumps({"jobId": job_id, "status": "generated", "summary": {"confirmedRevenue": 1000}, "downloadUrl": "/download"}), encoding="utf-8")
    (job_dir / "parsed" / "settlements.json").write_text("[]", encoding="utf-8")
    (job_dir / "parsed" / "files.json").write_text(json.dumps([{
        "fileId": "file_settlement_001",
        "fileName": "不能作为提示的文件名.xlsx",
        "fileType": "settlement_excel",
        "parseStatus": "warning",
        "aiStatus": "failed",
        "aiRetryCount": 0,
        "textPath": "extracted/texts/file_settlement_001.txt",
        "aiExtractPath": "extracted/ai_extracts/file_settlement_001.json",
    }]), encoding="utf-8")

    captured = {}

    def fake_extract(text, file_name):
        captured.update({"text": text, "file_name": file_name})
        return {"status": "success", "model": "test", "triedAt": "2026-07-13T10:00:00", "records": [{
            "customerName": "甲有限公司", "settlementPeriod": "2026-05", "settlementAmount": 1000, "confidence": 0.95, "missingFields": [],
        }]}

    monkeypatch.setattr(service, "_extract_settlement_with_ai", fake_extract)

    job = service.retry_settlement_ai(job_id, "file_settlement_001")

    assert captured["text"] == "OCR 正文中的甲有限公司，合计 1000 元"
    assert job["status"] == "parsed"
    assert job["downloadUrl"] is None
    assert job["files"][0]["aiStatus"] == "success"
    assert json.loads((job_dir / "parsed" / "settlements.json").read_text(encoding="utf-8"))[0]["customerName"] == "甲有限公司"
    assert not (job_dir / "result" / "reconciliation.xlsx").exists()
