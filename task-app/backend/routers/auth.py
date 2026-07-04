"""認証 API（登録・ログイン・ログアウト）"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str):
    response.set_cookie(
        auth_service.SESSION_COOKIE,
        token,
        max_age=int(auth_service.SESSION_DURATION.total_seconds()),
        httponly=True,
        samesite="lax",
        path="/",
    )


@router.post("/register", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: schemas.AuthRequest, response: Response, db: Session = Depends(get_db)):
    """ユーザー登録（登録後そのままログイン状態になる）"""
    exists = (
        db.query(models.User)
        .filter(models.User.username == payload.username)
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="このユーザー名は既に使われています")

    user = models.User(
        username=payload.username,
        password_hash=auth_service.hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    session = auth_service.create_session(db, user.id)
    db.commit()
    _set_session_cookie(response, session.token)
    return user


@router.post("/login", response_model=schemas.UserOut)
def login(payload: schemas.AuthRequest, response: Response, db: Session = Depends(get_db)):
    user = (
        db.query(models.User)
        .filter(models.User.username == payload.username)
        .first()
    )
    if not user or not auth_service.verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="ユーザー名またはパスワードが違います")

    session = auth_service.create_session(db, user.id)
    db.commit()
    _set_session_cookie(response, session.token)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(auth_service.SESSION_COOKIE)
    if token:
        auth_service.delete_session(db, token)
        db.commit()
    response.delete_cookie(auth_service.SESSION_COOKIE, path="/")
    return None


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(auth_service.get_current_user)):
    return user
