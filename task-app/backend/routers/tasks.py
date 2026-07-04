"""タスク CRUD API（階層対応・進捗履歴自動記録）"""
from typing import List, Dict, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..services.auth_service import get_current_user, get_owned_project

router = APIRouter(tags=["tasks"])


# ===== ヘルパー =====

def _get_owned_task(db: Session, task_id: int, user: models.User) -> models.Task:
    """ログインユーザーのプロジェクトに属するタスクを取得（他人のものは404）"""
    task = (
        db.query(models.Task)
        .join(models.Project, models.Task.project_id == models.Project.id)
        .filter(models.Task.id == task_id, models.Project.owner_id == user.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

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


def _recompute_ancestor_progress(db: Session, parent_id: Optional[int]):
    """親タスクの進捗を子タスクの平均から自動計算する（祖先へ連鎖）。
    全ての子が100%になると親も100%（完了）になり、
    子が未完了に戻ると親の完了も解除される。コミットは呼び出し側。"""
    while parent_id is not None:
        parent = db.query(models.Task).filter(models.Task.id == parent_id).first()
        if not parent:
            break
        children = (
            db.query(models.Task.progress)
            .filter(models.Task.parent_task_id == parent_id)
            .all()
        )
        if not children:
            break
        computed = round(sum(c[0] for c in children) / len(children))
        if parent.progress != computed:
            parent.progress = computed
            _record_progress_history(db, parent)
            # autoflush=False のため明示的にflush（次の祖先が最新値を読めるように）
            db.flush()
        parent_id = parent.parent_task_id


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
    user: models.User = Depends(get_current_user),
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
            models.Project.owner_id == user.id,    # 自分のプロジェクトのみ
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
def list_tasks(
    project_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """プロジェクト配下のタスクを階層構造で返す"""
    get_owned_project(db, project_id, user)

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
    user: models.User = Depends(get_current_user),
):
    get_owned_project(db, project_id, user)

    _validate_assignee(db, payload.assignee_id)
    _validate_parent_task(db, project_id, payload.parent_task_id)

    task = models.Task(project_id=project_id, **payload.model_dump())
    db.add(task)
    db.flush()  # ID 確定のためフラッシュ

    # 初期進捗を履歴に記録
    _record_progress_history(db, task)
    # 親タスクの進捗を再計算
    _recompute_ancestor_progress(db, task.parent_task_id)

    db.commit()
    db.refresh(task)
    return task


# ===== タスク取得 =====

@router.get("/api/tasks/{task_id}", response_model=schemas.TaskOut)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    return _get_owned_task(db, task_id, user)


# ===== タスク更新 =====

@router.put("/api/tasks/{task_id}", response_model=schemas.TaskOut)
def update_task(
    task_id: int,
    payload: schemas.TaskUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    task = _get_owned_task(db, task_id, user)

    _validate_assignee(db, payload.assignee_id)
    _validate_parent_task(db, task.project_id, payload.parent_task_id, self_task_id=task_id)

    old_progress = task.progress
    old_parent_id = task.parent_task_id
    for k, v in payload.model_dump().items():
        setattr(task, k, v)

    # 進捗が変わった場合のみ履歴に記録
    if task.progress != old_progress:
        _record_progress_history(db, task)

    # 親タスクの進捗を再計算（進捗変更・親付け替えの両方に対応）
    if task.progress != old_progress or task.parent_task_id != old_parent_id:
        db.flush()
        _recompute_ancestor_progress(db, task.parent_task_id)
        if old_parent_id != task.parent_task_id:
            _recompute_ancestor_progress(db, old_parent_id)

    db.commit()
    db.refresh(task)
    return task


# ===== タスク移動 =====

@router.post("/api/tasks/{task_id}/move", response_model=schemas.TaskOut)
def move_task(
    task_id: int,
    payload: schemas.TaskMoveRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """タスクと全子孫を別プロジェクトへ移動する。移動したタスクの親タスク参照はクリアされる。"""
    task = _get_owned_task(db, task_id, user)
    if task.project_id == payload.target_project_id:
        raise HTTPException(status_code=400, detail="Task is already in the target project")

    # 移動先も自分のプロジェクトであること
    get_owned_project(db, payload.target_project_id, user)

    # 子孫をすべて収集（BFS）
    all_ids: List[int] = []
    queue = [task_id]
    while queue:
        current_id = queue.pop(0)
        all_ids.append(current_id)
        children = (
            db.query(models.Task.id)
            .filter(models.Task.parent_task_id == current_id)
            .all()
        )
        queue.extend(row[0] for row in children)

    # プロジェクトを跨ぐことになる依存関係は解除（ツリー内部の依存は維持）
    db.query(models.TaskDependency).filter(
        models.TaskDependency.predecessor_id.in_(all_ids),
        ~models.TaskDependency.successor_id.in_(all_ids),
    ).delete(synchronize_session=False)
    db.query(models.TaskDependency).filter(
        models.TaskDependency.successor_id.in_(all_ids),
        ~models.TaskDependency.predecessor_id.in_(all_ids),
    ).delete(synchronize_session=False)

    # 一括更新：project_id を書き換え、ルートタスクの parent_task_id をクリア
    old_parent_id = task.parent_task_id
    db.query(models.Task).filter(models.Task.id.in_(all_ids)).update(
        {"project_id": payload.target_project_id}, synchronize_session=False
    )
    task.parent_task_id = None
    db.flush()
    # 移動元の親の進捗を再計算
    _recompute_ancestor_progress(db, old_parent_id)

    db.commit()
    db.refresh(task)
    return task


# ===== タスク削除 =====

@router.delete("/api/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    task = _get_owned_task(db, task_id, user)
    parent_id = task.parent_task_id
    db.delete(task)
    db.flush()
    # 残った兄弟から親の進捗を再計算
    _recompute_ancestor_progress(db, parent_id)
    db.commit()
    return None


# ===== 進捗履歴 =====

@router.get(
    "/api/tasks/{task_id}/history",
    response_model=List[schemas.ProgressHistoryOut],
)
def get_task_history(
    task_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _get_owned_task(db, task_id, user)
    return (
        db.query(models.TaskProgressHistory)
        .filter(models.TaskProgressHistory.task_id == task_id)
        .order_by(models.TaskProgressHistory.changed_at.asc())
        .all()
    )
