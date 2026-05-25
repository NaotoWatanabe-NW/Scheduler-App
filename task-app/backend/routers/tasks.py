"""タスク CRUD API（階層対応・進捗履歴自動記録）"""
from typing import List, Dict, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas

router = APIRouter(tags=["tasks"])


# ===== ヘルパー =====

def _validate_assignee(db: Session, assignee_id: Optional[int]):
    """担当者が存在するかチェック"""
    if assignee_id is None:
        return
    exists = db.query(models.Member).filter(models.Member.id == assignee_id).first()
    if not exists:
        raise HTTPException(
            status_code=400, detail=f"Assignee {assignee_id} not found"
        )


def _validate_parent_task(
    db: Session,
    project_id: int,
    parent_task_id: Optional[int],
    self_task_id: Optional[int] = None,
):
    """親タスクが存在し、同一プロジェクトであり、循環参照を起こさないかチェック"""
    if parent_task_id is None:
        return
    if parent_task_id == self_task_id:
        raise HTTPException(status_code=400, detail="Task cannot be its own parent")

    parent = db.query(models.Task).filter(models.Task.id == parent_task_id).first()
    if not parent:
        raise HTTPException(
            status_code=400, detail=f"Parent task {parent_task_id} not found"
        )
    if parent.project_id != project_id:
        raise HTTPException(
            status_code=400,
            detail="Parent task must be in the same project",
        )

    # 循環参照チェック: self_task_id の子孫を親に指定すると循環する
    if self_task_id is not None:
        ancestor = parent
        visited = set()
        while ancestor is not None:
            if ancestor.id in visited:
                # 既に循環している（理論上ありえないが防御）
                raise HTTPException(status_code=400, detail="Circular ancestry detected")
            visited.add(ancestor.id)
            if ancestor.id == self_task_id:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot set descendant as parent (would create cycle)",
                )
            if ancestor.parent_task_id is None:
                break
            ancestor = db.query(models.Task).filter(
                models.Task.id == ancestor.parent_task_id
            ).first()


def _record_progress_history(db: Session, task: models.Task):
    """進捗履歴に1行追加（コミットは呼び出し側）"""
    history = models.TaskProgressHistory(
        task_id=task.id, progress=task.progress
    )
    db.add(history)


def _build_task_tree(tasks: List[models.Task]) -> List[dict]:
    """フラットなタスクリストを階層構造に組み立てる。
    並び順は同階層内で start_date 昇順。"""
    # id -> dict のマップを作る
    task_map: Dict[int, dict] = {}
    for t in tasks:
        task_map[t.id] = {
            "id": t.id,
            "project_id": t.project_id,
            "parent_task_id": t.parent_task_id,
            "assignee_id": t.assignee_id,
            "name": t.name,
            "description": t.description,
            "start_date": t.start_date,
            "end_date": t.end_date,
            "progress": t.progress,
            "is_milestone": t.is_milestone,
            "created_at": t.created_at,
            "updated_at": t.updated_at,
            "children": [],
        }

    roots: List[dict] = []
    for t in tasks:
        node = task_map[t.id]
        if t.parent_task_id and t.parent_task_id in task_map:
            task_map[t.parent_task_id]["children"].append(node)
        else:
            roots.append(node)

    # 各階層を start_date 昇順でソート
    def _sort_recursive(nodes: List[dict]):
        nodes.sort(key=lambda n: (n["start_date"], n["id"]))
        for n in nodes:
            _sort_recursive(n["children"])

    _sort_recursive(roots)
    return roots


@router.get(
    "/api/tasks/todo",
    tags=["tasks"],
)
def list_todo_tasks(
    assignee_id: Optional[int] = None,
    project_id: Optional[int] = None,
    today: Optional[date] = None,
    db: Session = Depends(get_db),
):
    """進捗100%未満かつ開始日が今日以前のタスクを横断的に返す。
    完了済みプロジェクトのタスクは除外。
    レスポンスは「タスク＋プロジェクト名」を含む。"""
    from datetime import date as _date
    if today is None:
        today = _date.today()

    query = (
        db.query(models.Task, models.Project.name.label("project_name"))
        .join(models.Project, models.Task.project_id == models.Project.id)
        .filter(
            models.Project.is_completed == False,  # 完了プロジェクトを除外
            models.Task.progress < 100,
            models.Task.start_date <= today,
        )
    )

    if assignee_id is not None:
        if assignee_id == 0:
            query = query.filter(models.Task.assignee_id.is_(None))
        else:
            query = query.filter(models.Task.assignee_id == assignee_id)

    if project_id is not None:
        query = query.filter(models.Task.project_id == project_id)

    # 子タスクを持つ親はToDoから除外（グループ見出しなので個別の作業対象ではない）
    # 親判定: 自分を親に持つタスクが存在するか
    rows = query.order_by(models.Task.end_date.asc(), models.Task.id.asc()).all()

    # 子を持つタスクIDセットを取得
    parents_with_children = set(
        row[0] for row in db.query(models.Task.parent_task_id)
        .filter(models.Task.parent_task_id.is_not(None))
        .distinct().all()
    )

    result = []
    for task, project_name in rows:
        if task.id in parents_with_children:
            continue  # 親タスクは除外
        result.append({
            "id": task.id,
            "project_id": task.project_id,
            "project_name": project_name,
            "parent_task_id": task.parent_task_id,
            "assignee_id": task.assignee_id,
            "name": task.name,
            "description": task.description,
            "start_date": task.start_date,
            "end_date": task.end_date,
            "progress": task.progress,
            "is_milestone": task.is_milestone,
            "days_remaining": (task.end_date - today).days,
        })

    return result


# ===== タスク一覧（プロジェクト配下） =====

@router.get(
    "/api/projects/{project_id}/tasks",
    response_model=List[schemas.TaskWithChildren],
)
def list_tasks(project_id: int, db: Session = Depends(get_db)):
    """プロジェクト配下のタスクを階層構造で返す"""
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    tasks = (
        db.query(models.Task)
        .filter(models.Task.project_id == project_id)
        .all()
    )
    return _build_task_tree(tasks)


# ===== タスク作成 =====

@router.post(
    "/api/projects/{project_id}/tasks",
    response_model=schemas.TaskOut,
    status_code=status.HTTP_201_CREATED,
)
def create_task(
    project_id: int,
    payload: schemas.TaskCreate,
    db: Session = Depends(get_db),
):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    _validate_assignee(db, payload.assignee_id)
    _validate_parent_task(db, project_id, payload.parent_task_id)

    task = models.Task(project_id=project_id, **payload.model_dump())
    db.add(task)
    db.flush()  # ID 確定のためフラッシュ

    # 初期進捗を履歴に記録
    _record_progress_history(db, task)

    db.commit()
    db.refresh(task)
    return task


# ===== タスク取得 =====

@router.get("/api/tasks/{task_id}", response_model=schemas.TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ===== タスク更新 =====

@router.put("/api/tasks/{task_id}", response_model=schemas.TaskOut)
def update_task(
    task_id: int,
    payload: schemas.TaskUpdate,
    db: Session = Depends(get_db),
):
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    _validate_assignee(db, payload.assignee_id)
    _validate_parent_task(db, task.project_id, payload.parent_task_id, self_task_id=task_id)

    old_progress = task.progress
    for k, v in payload.model_dump().items():
        setattr(task, k, v)

    # 進捗が変わった場合のみ履歴に記録
    if task.progress != old_progress:
        _record_progress_history(db, task)

    db.commit()
    db.refresh(task)
    return task


# ===== タスク削除 =====

@router.delete("/api/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return None


# ===== 進捗履歴 =====

@router.get(
    "/api/tasks/{task_id}/history",
    response_model=List[schemas.ProgressHistoryOut],
)
def get_task_history(task_id: int, db: Session = Depends(get_db)):
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return (
        db.query(models.TaskProgressHistory)
        .filter(models.TaskProgressHistory.task_id == task_id)
        .order_by(models.TaskProgressHistory.changed_at.asc())
        .all()
    )
