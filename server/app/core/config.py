from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CEO 现金流驾驶舱 API"
    app_env: str = "development"
    database_url: str = "postgresql+psycopg://kb_user:kb_password@localhost:5432/cockpit"
    max_upload_bytes: int = 10 * 1024 * 1024
    rule_version: str = "cashflow-rules-v0.1"
    review_status: str = "pending_cfo_review"
    ai_enabled: bool = True
    ai_model: str = "qwen-plus"
    dashscope_api_key: str | None = "sk-ff3473910a184ea8860e983562034c19"
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ai_timeout_seconds: int = 30
    ai_max_retries: int = 1
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
