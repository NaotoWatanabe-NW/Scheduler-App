"""SQLAlchemy のデータベース接続設定"""
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# DBファイルの場所（backend/ から見て ../data/tasks.db）
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "tasks.db"

DATABASE_URL = f"sqlite:///{DB_PATH}"

# SQLite で外部キー制約を有効にし、複数スレッドからのアクセスを許可
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)

# 外部キー制約を有効化
from sqlalchemy import event

@event.listens_for(engine, "connect")
def _enable_foreign_keys(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI 依存性注入用の DB セッション"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """全テーブルを作成（存在しない場合のみ）"""
    # models をインポートしてメタデータに登録
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    # 既存DBに対する軽量マイグレーション
    _apply_migrations()


def _apply_migrations():
    """既存DBに対してカラム追加など軽量マイグレーションを行う。
    新しいカラムを追加した場合はここに追記する。"""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    project_cols = {c["name"] for c in inspector.get_columns("projects")}

    with engine.begin() as conn:
        # is_completed カラムの追加（既存DB対応）
        if "is_completed" not in project_cols:
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN is_completed BOOLEAN NOT NULL DEFAULT 0"
            ))
            print("[migration] Added projects.is_completed column")
