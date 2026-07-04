"""認証サービス

- パスワードは PBKDF2-HMAC-SHA256（ソルト付き）でハッシュ化（外部ライブラリ不要）
- セッションはランダムトークンを user_sessions テーブルに保存し、Cookieで受け渡す
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models

SESSION_COOKIE = "session_token"
SESSION_DURATION = timedelta(days=30)
_PBKDF2_ITERATIONS = 120_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERATIONS
    )
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, expected = stored.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERATIONS
    )
    return hmac.compare_digest(digest.hex(), expected)


def create_session(db: Session, user_id: int) -> models.UserSession:
    """セッションを発行する（コミットは呼び出し側）"""
    session = models.UserSession(
        token=secrets.token_hex(32),
        user_id=user_id,
        expires_at=datetime.now() + SESSION_DURATION,
    )
    db.add(session)
    return session


def delete_session(db: Session, token: str):
    db.query(models.UserSession).filter(
        models.UserSession.token == token
    ).delete()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    """Cookieのセッショントークンからログインユーザーを取得する。
    未ログイン・期限切れは401。"""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session = (
        db.query(models.UserSession)
        .filter(
            models.UserSession.token == token,
            models.UserSession.expires_at > datetime.now(),
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=401, detail="Session expired")
    return session.user


def get_owned_project(db: Session, project_id: int, user: models.User) -> models.Project:
    """ログインユーザーが所有するプロジェクトを取得（他人のものは404）"""
    project = (
        db.query(models.Project)
        .filter(
            models.Project.id == project_id,
            models.Project.owner_id == user.id,
        )
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
