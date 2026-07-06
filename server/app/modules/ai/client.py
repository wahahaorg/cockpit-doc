from functools import lru_cache

from langchain_openai import ChatOpenAI

from app.core.config import get_settings


def ai_available() -> bool:
    settings = get_settings()
    return settings.ai_enabled and bool(settings.dashscope_api_key)


@lru_cache
def get_chat_model() -> ChatOpenAI:
    settings = get_settings()
    return ChatOpenAI(
        model=settings.ai_model,
        api_key=settings.dashscope_api_key,
        base_url=settings.dashscope_base_url,
        temperature=0.1,
        timeout=settings.ai_timeout_seconds,
        max_retries=settings.ai_max_retries,
        stream_usage=False,
    )
