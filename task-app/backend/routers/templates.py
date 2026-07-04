"""タスクテンプレート API

テンプレート（タスク一式＋必要日数＋先行タスク）の CRUD と、プロジェクトへの適用。
適用時は開始日（前方計算）または終了日（逆算）を起点に、必要日数と依存関係から
各タスクの日付を自動計算する。アイテム間の依存関係はタスクの依存関係として
コピーされるため、適用直後からフロー図に反映される。
"""
from datetime import date, timedelta
from typing import Dict, List, Optional, Set
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..services import jp_holidays
from ..services.auth_service import get_current_user, get_owned_project

router = APIRouter(tags=["templates"])


# ===== ヘルパー =====

def _build_item_tree(items: List[models.TaskTemplateItem]) -> List[dict]:
    """フラットなアイテムリストを order_index 順の階層構造に組み立てる"""
    item_map = {}
    for it in items:
        item_map[it.id] = {
            "id": it.id,
            "name": it.name,
            "description": it.description,
            "duration_days": it.duration_days,
            "_order": it.order_index,
            "_parent": it.parent_item_id,
            "children": [],
        }

    roots = []
    for node in item_map.values():
        if node["_parent"] and node["_parent"] in item_map:
            item_map[node["_parent"]]["children"].append(node)
        else:
            roots.append(node)

    def _sort(nodes):
        nodes.sort(key=lambda n: (n["_order"], n["id"]))
        for n in nodes:
            _sort(n["children"])
            del n["_order"], n["_parent"]

    _sort(roots)
    return roots


def _template_dependencies(db: Session, template_id: int) -> List[models.TemplateItemDependency]:
    return (
        db.query(models.TemplateItemDependency)
        .filter(models.TemplateItemDependency.template_id == template_id)
        .all()
    )


def _to_response(db: Session, template: models.TaskTemplate) -> dict:
    return {
        "id": template.id,
        "name": template.name,
        "description": template.description,
        "created_at": template.created_at,
        "updated_at": template.updated_at,
        "items": _build_item_tree(template.items),
        "dependencies": [
            {"predecessor_id": d.predecessor_item_id, "successor_id": d.successor_item_id}
            for d in _template_dependencies(db, template.id)
        ],
    }


def _create_items(
    db: Session,
    template_id: int,
    items_in: List[schemas.TemplateItemIn],
    key_to_id: Dict[str, int],
    parent_item_id: Optional[int] = None,
):
    """ネストされたアイテム定義を再帰的に登録し、key→アイテムID のマップを作る"""
    for i, item_in in enumerate(items_in):
        item = models.TaskTemplateItem(
            template_id=template_id,
            parent_item_id=parent_item_id,
            name=item_in.name,
            description=item_in.description,
            duration_days=item_in.duration_days,
            order_index=i,
        )
        db.add(item)
        db.flush()  # 子のparent_item_id用にID確定
        if item_in.key:
            if item_in.key in key_to_id:
                raise HTTPException(
                    status_code=400, detail=f"Duplicate item key: {item_in.key}"
                )
            key_to_id[item_in.key] = item.id
        if item_in.children:
            _create_items(db, template_id, item_in.children, key_to_id, parent_item_id=item.id)


def _has_cycle(edges: List[tuple]) -> bool:
    """(pred, succ) のエッジ集合に循環があるか"""
    graph: Dict[int, List[int]] = {}
    for p, s in edges:
        graph.setdefault(p, []).append(s)

    visited: Set[int] = set()
    in_stack: Set[int] = set()

    def visit(node) -> bool:
        if node in in_stack:
            return True
        if node in visited:
            return False
        visited.add(node)
        in_stack.add(node)
        for nxt in graph.get(node, []):
            if visit(nxt):
                return True
        in_stack.discard(node)
        return False

    return any(visit(n) for n in list(graph.keys()))


def _create_dependencies(
    db: Session,
    template_id: int,
    deps_in: List[schemas.TemplateDependencyIn],
    key_to_id: Dict[str, int],
):
    """key で参照された依存関係を検証して登録する"""
    edges = []
    seen = set()
    for dep in deps_in:
        if dep.predecessor_key not in key_to_id or dep.successor_key not in key_to_id:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown item key in dependency: "
                       f"{dep.predecessor_key} -> {dep.successor_key}",
            )
        p = key_to_id[dep.predecessor_key]
        s = key_to_id[dep.successor_key]
        if p == s:
            raise HTTPException(status_code=400, detail="Item cannot depend on itself")
        if (p, s) in seen:
            continue  # 重複は黙って除外
        seen.add((p, s))
        edges.append((p, s))

    if _has_cycle(edges):
        raise HTTPException(
            status_code=400, detail="Dependencies would create a cycle"
        )

    for p, s in edges:
        db.add(models.TemplateItemDependency(
            template_id=template_id,
            predecessor_item_id=p,
            successor_item_id=s,
        ))


# ===== テンプレート CRUD =====

@router.get("/api/templates", response_model=List[schemas.TemplateOut])
def list_templates(db: Session = Depends(get_db)):
    templates = (
        db.query(models.TaskTemplate)
        .order_by(models.TaskTemplate.created_at.asc())
        .all()
    )
    return [_to_response(db, t) for t in templates]


@router.post(
    "/api/templates",
    response_model=schemas.TemplateOut,
    status_code=status.HTTP_201_CREATED,
)
def create_template(payload: schemas.TemplateCreate, db: Session = Depends(get_db)):
    template = models.TaskTemplate(name=payload.name, description=payload.description)
    db.add(template)
    db.flush()
    key_to_id: Dict[str, int] = {}
    _create_items(db, template.id, payload.items, key_to_id)
    _create_dependencies(db, template.id, payload.dependencies, key_to_id)
    db.commit()
    db.refresh(template)
    return _to_response(db, template)


@router.get("/api/templates/{template_id}", response_model=schemas.TemplateOut)
def get_template(template_id: int, db: Session = Depends(get_db)):
    template = (
        db.query(models.TaskTemplate)
        .filter(models.TaskTemplate.id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return _to_response(db, template)


@router.put("/api/templates/{template_id}", response_model=schemas.TemplateOut)
def update_template(
    template_id: int,
    payload: schemas.TemplateUpdate,
    db: Session = Depends(get_db),
):
    """名前・説明を更新し、アイテムと依存関係は総入れ替えする"""
    template = (
        db.query(models.TaskTemplate)
        .filter(models.TaskTemplate.id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    template.name = payload.name
    template.description = payload.description
    # 既存の依存→アイテムの順に削除して作り直す
    db.query(models.TemplateItemDependency).filter(
        models.TemplateItemDependency.template_id == template_id
    ).delete()
    db.query(models.TaskTemplateItem).filter(
        models.TaskTemplateItem.template_id == template_id
    ).delete()
    db.flush()
    key_to_id: Dict[str, int] = {}
    _create_items(db, template_id, payload.items, key_to_id)
    _create_dependencies(db, template_id, payload.dependencies, key_to_id)
    db.commit()
    db.refresh(template)
    return _to_response(db, template)


@router.delete("/api/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    template = (
        db.query(models.TaskTemplate)
        .filter(models.TaskTemplate.id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(template)
    db.commit()
    return None


# ===== テンプレート適用（日程計算） =====

def _collect_leaves(node: dict) -> List[dict]:
    """アイテムの末端（子を持たない）子孫を返す。自身が末端なら自身のみ。"""
    if not node["children"]:
        return [node]
    result = []
    for c in node["children"]:
        result.extend(_collect_leaves(c))
    return result


def _schedule_items(
    items: List[dict],
    item_deps: List[tuple],
    anchor_start: Optional[date],
    anchor_end: Optional[date],
    skip: bool,
):
    """各アイテムに start / end を割り当てる。

    - 依存関係なし: 末端タスクを並び順に直列配置
    - 依存関係あり: 先行タスクが全て終わってから開始（先行がなければ起点日）。
      並行作業は同じ日から始まる
    - anchor_end 指定時は逆算（後続から順に遡って配置）
    - 親アイテムは子孫の期間全体をカバー
    """
    # 末端アイテムの一覧と、アイテムID→末端集合のマップ
    all_leaves: List[dict] = []
    for root in items:
        all_leaves.extend(_collect_leaves(root))
    leaf_by_id = {leaf["id"]: leaf for leaf in all_leaves}

    id_to_node: Dict[int, dict] = {}

    def index_nodes(nodes):
        for n in nodes:
            id_to_node[n["id"]] = n
            index_nodes(n["children"])

    index_nodes(items)

    # アイテム間依存を末端間依存に展開（親への依存は「その子孫全部」への依存）
    leaf_edges: Set[tuple] = set()
    for p_id, s_id in item_deps:
        p_leaves = _collect_leaves(id_to_node[p_id]) if p_id in id_to_node else []
        s_leaves = _collect_leaves(id_to_node[s_id]) if s_id in id_to_node else []
        for pl in p_leaves:
            for sl in s_leaves:
                if pl["id"] != sl["id"]:
                    leaf_edges.add((pl["id"], sl["id"]))

    # 日付演算ヘルパー（営業日 or 暦日）
    def fwd_start(base: date) -> date:
        return jp_holidays.next_working_day(base) if skip else base

    def fwd_end(start: date, dur: int) -> date:
        return jp_holidays.add_working_days(start, dur) if skip \
            else start + timedelta(days=dur - 1)

    def bwd_end(base: date) -> date:
        return jp_holidays.prev_working_day(base) if skip else base

    def bwd_start(end: date, dur: int) -> date:
        return jp_holidays.sub_working_days(end, dur) if skip \
            else end - timedelta(days=dur - 1)

    if not leaf_edges:
        # 直列配置
        if anchor_start is not None:
            cursor = anchor_start
            for leaf in all_leaves:
                start = fwd_start(cursor)
                end = fwd_end(start, leaf["duration_days"])
                leaf["start"], leaf["end"] = start, end
                cursor = end + timedelta(days=1)
        else:
            cursor = anchor_end
            for leaf in reversed(all_leaves):
                end = bwd_end(cursor)
                start = bwd_start(end, leaf["duration_days"])
                leaf["start"], leaf["end"] = start, end
                cursor = start - timedelta(days=1)
    else:
        # 依存関係に基づく配置（トポロジカル順）
        preds: Dict[int, Set[int]] = {leaf["id"]: set() for leaf in all_leaves}
        succs: Dict[int, Set[int]] = {leaf["id"]: set() for leaf in all_leaves}
        for p, s in leaf_edges:
            preds[s].add(p)
            succs[p].add(s)

        if anchor_start is not None:
            # 前方: 先行が全て終わってから開始
            remaining = {leaf["id"] for leaf in all_leaves}
            resolved: Set[int] = set()
            while remaining:
                ready = [lid for lid in remaining if preds[lid] <= resolved]
                if not ready:
                    raise HTTPException(
                        status_code=400, detail="Template dependencies contain a cycle"
                    )
                for lid in ready:
                    leaf = leaf_by_id[lid]
                    if preds[lid]:
                        base = max(leaf_by_id[p]["end"] for p in preds[lid]) + timedelta(days=1)
                    else:
                        base = anchor_start
                    start = fwd_start(base)
                    leaf["start"] = start
                    leaf["end"] = fwd_end(start, leaf["duration_days"])
                    remaining.discard(lid)
                    resolved.add(lid)
        else:
            # 逆算: 後続が全て決まってから、その直前に終わるよう配置
            remaining = {leaf["id"] for leaf in all_leaves}
            resolved: Set[int] = set()
            while remaining:
                ready = [lid for lid in remaining if succs[lid] <= resolved]
                if not ready:
                    raise HTTPException(
                        status_code=400, detail="Template dependencies contain a cycle"
                    )
                for lid in ready:
                    leaf = leaf_by_id[lid]
                    if succs[lid]:
                        base = min(leaf_by_id[s]["start"] for s in succs[lid]) - timedelta(days=1)
                    else:
                        base = anchor_end
                    end = bwd_end(base)
                    leaf["end"] = end
                    leaf["start"] = bwd_start(end, leaf["duration_days"])
                    remaining.discard(lid)
                    resolved.add(lid)

    # 親アイテムは子孫の期間をカバー
    def span(nodes):
        for node in nodes:
            if node["children"]:
                span(node["children"])
                node["start"] = min(c["start"] for c in node["children"])
                node["end"] = max(c["end"] for c in node["children"])

    span(items)


@router.post("/api/projects/{project_id}/apply-template")
def apply_template(
    project_id: int,
    payload: schemas.ApplyTemplateRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """テンプレートからタスク一式を作成する。

    - start_date 指定: 開始日から前方に日程を計算
    - end_date 指定: 終了日に間に合うように逆算
    - アイテム間の依存関係はタスクの依存関係としてコピーされる
    """
    get_owned_project(db, project_id, user)

    template = (
        db.query(models.TaskTemplate)
        .filter(models.TaskTemplate.id == payload.template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    items = _build_item_tree(template.items)
    if not items:
        raise HTTPException(status_code=400, detail="Template has no items")

    item_deps = [
        (d.predecessor_item_id, d.successor_item_id)
        for d in _template_dependencies(db, template.id)
    ]

    _schedule_items(
        items, item_deps,
        anchor_start=payload.start_date,
        anchor_end=payload.end_date,
        skip=payload.skip_non_working,
    )

    # タスクを作成（親→子の順でIDを確定させ、アイテムID→タスクIDを記録）
    created_count = 0
    item_to_task: Dict[int, int] = {}

    def create_tasks(nodes, parent_task_id):
        nonlocal created_count
        for node in nodes:
            task = models.Task(
                project_id=project_id,
                parent_task_id=parent_task_id,
                name=node["name"],
                description=node["description"],
                start_date=node["start"],
                end_date=node["end"],
                progress=0,
            )
            db.add(task)
            db.flush()
            # 初期進捗を履歴に記録（通常のタスク作成と同様）
            db.add(models.TaskProgressHistory(task_id=task.id, progress=0))
            item_to_task[node["id"]] = task.id
            created_count += 1
            create_tasks(node["children"], task.id)

    create_tasks(items, None)

    # アイテム間の依存関係をタスクの依存関係としてコピー
    for p_item, s_item in item_deps:
        if p_item in item_to_task and s_item in item_to_task:
            db.add(models.TaskDependency(
                predecessor_id=item_to_task[p_item],
                successor_id=item_to_task[s_item],
            ))

    db.commit()

    all_dates = []

    def collect(nodes):
        for n in nodes:
            all_dates.append((n["start"], n["end"]))
            collect(n["children"])

    collect(items)
    return {
        "created_tasks": created_count,
        "created_dependencies": len(item_deps),
        "start_date": min(d[0] for d in all_dates).isoformat(),
        "end_date": max(d[1] for d in all_dates).isoformat(),
    }
