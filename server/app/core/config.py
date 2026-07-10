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
    ai_model: str = "qwen3:8b"
    ollama_base_url: str = "http://192.168.2.124:11434/v1"
    ollama_api_key: str = "ollama"  # Ollama 不需要真实 key，但 OpenAI 客户端要求非空
    ai_timeout_seconds: int = 30
    ai_max_retries: int = 1
    income_reconciliation_storage_dir: str = "storage"
    income_reconciliation_ai_enabled: bool = False
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
