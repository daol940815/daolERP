from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://finbook_user:finbook_pass@db:5432/finbook"
    SECRET_KEY: str = "finbook-secret-key"
    DEBUG: bool = True
    UPLOAD_DIR: str = "/app/uploads"
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024  # 50MB

    class Config:
        env_file = ".env"


settings = Settings()
