"""FastAPI アプリエントリ"""
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .database import init_db, SessionLocal
from .routers import projects, members, tasks, snapshots
from .services.snapshot_service import generate_missing_snapshots_all

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """起動時: DB初期化＋未記録週のスナップショット自動生成"""
    init_db()
    print(f"[startup] DB initialized at {BASE_DIR / 'data' / 'tasks.db'}")

    # 未記録週のスナップショットを生成
    db = SessionLocal()
    try:
        summary = generate_missing_snapshots_all(db)
        if summary:
            for pid, dates in summary.items():
                print(f"[startup] project {pid}: generated {len(dates)} snapshot(s) "
                      f"for {[d.isoformat() for d in dates]}")
        else:
            print("[startup] no missing snapshots to generate")
    except Exception as e:
        print(f"[startup] snapshot generation failed: {e}")
        db.rollback()
    finally:
        db.close()

    yield
    print("[shutdown] bye")


app = FastAPI(title="Task App", version="0.4.0", lifespan=lifespan)


# キャッシュ無効化ミドルウェア
# 静的ファイル（JS/CSS/HTML）にCache-Control: no-store を付けて
# ブラウザに毎回サーバから取得させる
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    # 静的ファイルとページにキャッシュ無効化を適用
    path = request.url.path
    if path.startswith("/static") or path == "/" or path.startswith("/projects") or path == "/members" or path == "/todo":
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# ルーター登録
app.include_router(projects.router)
app.include_router(members.router)
app.include_router(tasks.router)
app.include_router(snapshots.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# フロントエンド配信
# /static/* で frontend/js, frontend/css 等を配信
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
def index():
    """トップページ"""
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/projects/{project_id}")
def project_page(project_id: int):
    """プロジェクト詳細ページ（フェーズ4で実装）"""
    return FileResponse(FRONTEND_DIR / "project.html")


@app.get("/members")
def members_page():
    """メンバー管理ページ"""
    return FileResponse(FRONTEND_DIR / "members.html")


@app.get("/todo")
def todo_page():
    """ToDoリストページ"""
    return FileResponse(FRONTEND_DIR / "todo.html")
