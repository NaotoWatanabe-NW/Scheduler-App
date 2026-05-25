"""スナップショット API（イナヅマ線データ）"""
from typing import List
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas

router = APIRouter(prefix="/api/projects/{project_id}/snapshots", tags=["snapshots"])


@router.get("", response_model=List[schemas.SnapshotOut])
def list_snapshots(project_id: int, db: Session = Depends(get_db)):
    """プロジェクトのスナップショット一覧を新しい順で返す"""
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return (
        db.query(models.ProgressSnapshot)
        .filter(models.ProgressSnapshot.project_id == project_id)
        .order_by(models.ProgressSnapshot.snapshot_date.desc())
        .all()
    )


@router.post("", response_model=schemas.SnapshotOut, status_code=status.HTTP_201_CREATED)
def create_snapshot(
    project_id: int,
    payload: schemas.SnapshotCreate,
    db: Session = Depends(get_db),
):
    """手動でスナップショットを作成。現在の各タスクの progress をそのまま記録する。
    snapshot_date 未指定なら今日。同じ日付のスナップショットがあれば上書き。"""
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    snap_date = payload.snapshot_date or date.today()

    # 同日のスナップショットがあれば削除（上書き）
    existing = (
        db.query(models.ProgressSnapshot)
        .filter(
            models.ProgressSnapshot.project_id == project_id,
            models.ProgressSnapshot.snapshot_date == snap_date,
        )
        .first()
    )
    if existing:
        db.delete(existing)
        db.flush()

    snapshot = models.ProgressSnapshot(
        project_id=project_id, snapshot_date=snap_date
    )
    db.add(snapshot)
    db.flush()

    # プロジェクト配下の全タスクの現在進捗を記録
    tasks = db.query(models.Task).filter(models.Task.project_id == project_id).all()
    for task in tasks:
        db.add(models.SnapshotTaskProgress(
            snapshot_id=snapshot.id,
            task_id=task.id,
            progress=task.progress,
        ))

    db.commit()
    db.refresh(snapshot)
    return snapshot


@router.delete(
    "/{snapshot_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_snapshot(
    project_id: int,
    snapshot_id: int,
    db: Session = Depends(get_db),
):
    """スナップショットを個別に削除"""
    snapshot = (
        db.query(models.ProgressSnapshot)
        .filter(
            models.ProgressSnapshot.id == snapshot_id,
            models.ProgressSnapshot.project_id == project_id,
        )
        .first()
    )
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    db.delete(snapshot)
    db.commit()
    return None
