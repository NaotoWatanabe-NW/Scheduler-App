"""プロジェクト CRUD API"""
from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database import get_db
from .. import models, schemas

router = APIRouter(prefix="/api/projects", tags=["projects"])

# 将来の認証用：現状は固定オーナーID
CURRENT_OWNER_ID = 1


def _compute_effective_dates(db: Session, project: models.Project):
    """プロジェクトの実効的な開始日・終了日を計算する。
    手動設定値があればそれを優先、未設定ならタスクから算出。
    タスクもなければ None。"""
    eff_start = project.start_date
    eff_end = project.end_date

    if eff_start is None or eff_end is None:
        # タスクの最早開始日と最遅終了日を集計
        result = db.query(
            func.min(models.Task.start_date).label("min_start"),
            func.max(models.Task.end_date).label("max_end"),
        ).filter(models.Task.project_id == project.id).first()

        if eff_start is None:
            eff_start = result.min_start
        if eff_end is None:
            eff_end = result.max_end

    return eff_start, eff_end


def _to_response(db: Session, project: models.Project) -> dict:
    """ProjectモデルをProjectOutレスポンス用辞書に変換（effective日付を含む）"""
    eff_start, eff_end = _compute_effective_dates(db, project)
    return {
        "id": project.id,
        "owner_id": project.owner_id,
        "name": project.name,
        "description": project.description,
        "start_date": project.start_date,
        "end_date": project.end_date,
        "is_completed": project.is_completed,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "effective_start_date": eff_start,
        "effective_end_date": eff_end,
    }


@router.get("", response_model=List[schemas.ProjectOut])
def list_projects(
    include_completed: bool = False,
    db: Session = Depends(get_db),
):
    """プロジェクト一覧。デフォルトは未完了のみ。
    include_completed=true で完了済みも含めて返す。"""
    query = db.query(models.Project).filter(
        models.Project.owner_id == CURRENT_OWNER_ID
    )
    if not include_completed:
        query = query.filter(models.Project.is_completed == False)
    projects = query.order_by(models.Project.created_at.desc()).all()
    return [_to_response(db, p) for p in projects]


@router.post("", response_model=schemas.ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(payload: schemas.ProjectCreate, db: Session = Depends(get_db)):
    project = models.Project(
        owner_id=CURRENT_OWNER_ID,
        **payload.model_dump(),
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return _to_response(db, project)


@router.get("/{project_id}", response_model=schemas.ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _to_response(db, project)


@router.put("/{project_id}", response_model=schemas.ProjectOut)
def update_project(
    project_id: int,
    payload: schemas.ProjectUpdate,
    db: Session = Depends(get_db),
):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    for k, v in payload.model_dump().items():
        setattr(project, k, v)
    db.commit()
    db.refresh(project)
    return _to_response(db, project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return None
