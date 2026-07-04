"""タスク依存関係 API（先行→後続）"""
from typing import List, Dict, Set
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..services.auth_service import get_current_user, get_owned_project

router = APIRouter(tags=["dependencies"])


def _project_dependency_edges(db: Session, project_id: int) -> Dict[int, List[int]]:
    """プロジェクト内の依存関係を {predecessor_id: [successor_id, ...]} で返す"""
    deps = (
        db.query(models.TaskDependency)
        .join(models.Task, models.TaskDependency.predecessor_id == models.Task.id)
        .filter(models.Task.project_id == project_id)
        .all()
    )
    edges: Dict[int, List[int]] = {}
    for dep in deps:
        edges.setdefault(dep.predecessor_id, []).append(dep.successor_id)
    return edges


def _reachable(edges: Dict[int, List[int]], start: int, goal: int) -> bool:
    """依存グラフ上で start から goal に到達できるか（BFS）"""
    visited: Set[int] = set()
    queue = [start]
    while queue:
        current = queue.pop(0)
        if current == goal:
            return True
        if current in visited:
            continue
        visited.add(current)
        queue.extend(edges.get(current, []))
    return False


@router.get(
    "/api/projects/{project_id}/dependencies",
    response_model=List[schemas.DependencyOut],
)
def list_dependencies(
    project_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """プロジェクト内の依存関係一覧"""
    get_owned_project(db, project_id, user)

    return (
        db.query(models.TaskDependency)
        .join(models.Task, models.TaskDependency.predecessor_id == models.Task.id)
        .filter(models.Task.project_id == project_id)
        .all()
    )


@router.post(
    "/api/projects/{project_id}/dependencies",
    response_model=schemas.DependencyOut,
    status_code=status.HTTP_201_CREATED,
)
def create_dependency(
    project_id: int,
    payload: schemas.DependencyCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """依存関係を追加。同一プロジェクト内のみ、循環は禁止。"""
    get_owned_project(db, project_id, user)
    if payload.predecessor_id == payload.successor_id:
        raise HTTPException(status_code=400, detail="Task cannot depend on itself")

    pred = db.query(models.Task).filter(models.Task.id == payload.predecessor_id).first()
    succ = db.query(models.Task).filter(models.Task.id == payload.successor_id).first()
    if not pred or not succ:
        raise HTTPException(status_code=404, detail="Task not found")
    if pred.project_id != project_id or succ.project_id != project_id:
        raise HTTPException(
            status_code=400, detail="Both tasks must be in the same project"
        )

    existing = (
        db.query(models.TaskDependency)
        .filter(
            models.TaskDependency.predecessor_id == payload.predecessor_id,
            models.TaskDependency.successor_id == payload.successor_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Dependency already exists")

    # 循環チェック: 後続から先行に到達できるなら、このエッジで循環が生まれる
    edges = _project_dependency_edges(db, project_id)
    if _reachable(edges, payload.successor_id, payload.predecessor_id):
        raise HTTPException(
            status_code=400,
            detail="Cannot create dependency (would create a cycle)",
        )

    dep = models.TaskDependency(
        predecessor_id=payload.predecessor_id,
        successor_id=payload.successor_id,
    )
    db.add(dep)
    db.commit()
    db.refresh(dep)
    return dep


@router.delete("/api/dependencies/{dep_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dependency(
    dep_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    dep = (
        db.query(models.TaskDependency)
        .join(models.Task, models.TaskDependency.predecessor_id == models.Task.id)
        .join(models.Project, models.Task.project_id == models.Project.id)
        .filter(
            models.TaskDependency.id == dep_id,
            models.Project.owner_id == user.id,
        )
        .first()
    )
    if not dep:
        raise HTTPException(status_code=404, detail="Dependency not found")
    db.delete(dep)
    db.commit()
    return None
