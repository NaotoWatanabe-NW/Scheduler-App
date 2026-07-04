"""統合プロジェクト API

複数プロジェクトの進捗を1枚のガントチャートにまとめる閲覧専用ビュー。
各プロジェクトは「最早開始日〜最遅終了日」の1本のバーになり、
進捗点は配下の未完了タスクのうち「進捗到達日が最も遅れているもの」を採用する
（イナヅマ線の凹みと同じ考え方。基準日は今日）。
"""
from datetime import date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..services.auth_service import get_current_user

router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])


# ===== ヘルパー =====

def _get_owned_portfolio(
    db: Session, portfolio_id: int, user: models.User
) -> models.PortfolioProject:
    portfolio = (
        db.query(models.PortfolioProject)
        .filter(
            models.PortfolioProject.id == portfolio_id,
            models.PortfolioProject.owner_id == user.id,
        )
        .first()
    )
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return portfolio


def _validate_project_ids(db: Session, project_ids: List[int], user: models.User):
    """全プロジェクトがログインユーザーの所有であることを確認"""
    if not project_ids:
        return
    if len(set(project_ids)) != len(project_ids):
        raise HTTPException(status_code=400, detail="Duplicate project ids")
    owned = (
        db.query(models.Project.id)
        .filter(
            models.Project.id.in_(project_ids),
            models.Project.owner_id == user.id,
        )
        .all()
    )
    owned_ids = {row[0] for row in owned}
    missing = [pid for pid in project_ids if pid not in owned_ids]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"Project not found: {missing}"
        )


def _replace_items(db: Session, portfolio_id: int, project_ids: List[int]):
    db.query(models.PortfolioProjectItem).filter(
        models.PortfolioProjectItem.portfolio_id == portfolio_id
    ).delete()
    for i, pid in enumerate(project_ids):
        db.add(models.PortfolioProjectItem(
            portfolio_id=portfolio_id, project_id=pid, order_index=i
        ))


def _to_response(portfolio: models.PortfolioProject) -> dict:
    items = sorted(portfolio.items, key=lambda it: (it.order_index, it.id))
    return {
        "id": portfolio.id,
        "name": portfolio.name,
        "description": portfolio.description,
        "created_at": portfolio.created_at,
        "updated_at": portfolio.updated_at,
        "project_ids": [it.project_id for it in items],
    }


def _summarize_project(
    db: Session, project: models.Project, today: date
) -> Optional[dict]:
    """1プロジェクトを統合ビュー用に集計する。

    進捗点 = 未完了の末端タスクの進捗到達日（開始日＋期間×進捗%）の最小値。
    ただし「開始日が未来かつ未着手」のタスクは基準日（今日）扱い＝順調とみなす。
    全末端タスクが完了なら100%・遅延0。
    """
    tasks = (
        db.query(models.Task)
        .filter(models.Task.project_id == project.id)
        .all()
    )
    parent_ids = {t.parent_task_id for t in tasks if t.parent_task_id is not None}
    leaves = [t for t in tasks if t.id not in parent_ids]

    if not leaves:
        # タスクなし: 手動設定日があればバーだけ出す（進捗情報なし）
        return {
            "project_id": project.id,
            "name": project.name,
            "is_completed": project.is_completed,
            "start_date": project.start_date,
            "end_date": project.end_date,
            "task_count": 0,
            "progress_percent": None,
            "delay_days": None,
            "bottleneck_task": None,
        }

    start = min(t.start_date for t in leaves)
    end = max(t.end_date for t in leaves)
    span_days = (end - start).days + 1
    today_offset = (today - start).days  # 今日の位置（プロジェクト開始からの日数）

    incomplete = [t for t in leaves if t.progress < 100]
    if not incomplete:
        percent, delay, bottleneck = 100, 0, None
    else:
        # 各タスクの進捗到達位置（プロジェクト開始からの日数、小数）
        best = None  # (attain_offset, task)
        for t in incomplete:
            duration = (t.end_date - t.start_date).days + 1
            if t.start_date > today and t.progress == 0:
                # まだ開始予定が来ていない未着手タスク → 順調（基準日上）
                attain = float(today_offset)
            else:
                attain = (t.start_date - start).days + duration * (t.progress / 100.0)
            if best is None or attain < best[0]:
                best = (attain, t)
        attain, bottleneck_task = best
        percent = max(0, min(100, round(attain / span_days * 100)))
        delay = round(today_offset - attain)
        bottleneck = bottleneck_task.name

    return {
        "project_id": project.id,
        "name": project.name,
        "is_completed": project.is_completed,
        "start_date": start,
        "end_date": end,
        "task_count": len(leaves),
        "progress_percent": percent,
        "delay_days": delay,
        "bottleneck_task": bottleneck,
    }


# ===== CRUD =====

@router.get("", response_model=List[schemas.PortfolioOut])
def list_portfolios(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    portfolios = (
        db.query(models.PortfolioProject)
        .filter(models.PortfolioProject.owner_id == user.id)
        .order_by(models.PortfolioProject.created_at.asc())
        .all()
    )
    return [_to_response(p) for p in portfolios]


@router.post("", response_model=schemas.PortfolioOut, status_code=status.HTTP_201_CREATED)
def create_portfolio(
    payload: schemas.PortfolioCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _validate_project_ids(db, payload.project_ids, user)
    portfolio = models.PortfolioProject(
        owner_id=user.id, name=payload.name, description=payload.description
    )
    db.add(portfolio)
    db.flush()
    _replace_items(db, portfolio.id, payload.project_ids)
    db.commit()
    db.refresh(portfolio)
    return _to_response(portfolio)


@router.get("/{portfolio_id}", response_model=schemas.PortfolioOut)
def get_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    return _to_response(_get_owned_portfolio(db, portfolio_id, user))


@router.put("/{portfolio_id}", response_model=schemas.PortfolioOut)
def update_portfolio(
    portfolio_id: int,
    payload: schemas.PortfolioUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    portfolio = _get_owned_portfolio(db, portfolio_id, user)
    _validate_project_ids(db, payload.project_ids, user)
    portfolio.name = payload.name
    portfolio.description = payload.description
    _replace_items(db, portfolio_id, payload.project_ids)
    db.commit()
    db.refresh(portfolio)
    return _to_response(portfolio)


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    portfolio = _get_owned_portfolio(db, portfolio_id, user)
    db.delete(portfolio)
    db.commit()
    return None


# ===== 統合ビュー用の集計 =====

@router.get("/{portfolio_id}/summary", response_model=schemas.PortfolioSummaryOut)
def portfolio_summary(
    portfolio_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """統合ガント表示用: 各プロジェクトを1本のバーに集計して返す"""
    portfolio = _get_owned_portfolio(db, portfolio_id, user)
    today = date.today()

    items = sorted(portfolio.items, key=lambda it: (it.order_index, it.id))
    summaries = []
    for item in items:
        if item.project is None:
            continue  # プロジェクトが削除済み（CASCADEで通常は残らないが防御）
        summaries.append(_summarize_project(db, item.project, today))

    return {
        "id": portfolio.id,
        "name": portfolio.name,
        "description": portfolio.description,
        "base_date": today,
        "projects": summaries,
    }
