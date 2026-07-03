from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CEO 现金流驾驶舱 API"
    app_env: str = "development"
    database_url: str = "postgresql+psycopg://kb_user:kb_password@localhost:5432/cockpit"
    max_upload_bytes: int = 10 * 1024 * 1024
    rule_version: str = "cashflow-rules-v0.1"
    review_status: str = "pending_cfo_review"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
