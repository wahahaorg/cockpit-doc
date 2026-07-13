import re
import unicodedata
from dataclasses import dataclass
from enum import Enum


class CompanyMatchRelation(str, Enum):
    EXACT = "exact"
    SAME_MAIN_ENTITY = "same_main_entity"
    DIFFERENT = "different"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class CompanyName:
    original: str
    normalized: str
    main_entity: str | None
    branch: str | None


_PUNCTUATION = re.compile(r"[\s（）()【】\[\]、,，.。·・:：;；_-]+")
_BRANCH_PATTERN = re.compile(
    r"^(?P<main>.+?(?:集团有限公司|股份有限公司|有限责任公司|有限公司|公司))(?P<branch>.+?(?:分公司|支公司|营业部))$"
)


def normalize_company_name(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    return _PUNCTUATION.sub("", text)


def parse_company_name(value: object) -> CompanyName:
    original = str(value or "").strip()
    normalized = normalize_company_name(original)
    if not normalized:
        return CompanyName(original, "", None, None)
    match = _BRANCH_PATTERN.fullmatch(normalized)
    if match:
        return CompanyName(original, normalized, match.group("main"), match.group("branch"))
    return CompanyName(original, normalized, normalized, None)


def compare_company_names(left: object, right: object) -> CompanyMatchRelation:
    left_name = parse_company_name(left)
    right_name = parse_company_name(right)
    if not left_name.normalized or not right_name.normalized:
        return CompanyMatchRelation.UNKNOWN
    if left_name.normalized == right_name.normalized:
        return CompanyMatchRelation.EXACT
    if left_name.main_entity and left_name.main_entity == right_name.main_entity:
        return CompanyMatchRelation.SAME_MAIN_ENTITY
    return CompanyMatchRelation.DIFFERENT
