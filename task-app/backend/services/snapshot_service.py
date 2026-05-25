"""起動時のスナップショット自動生成サービス

プロジェクトごとに「未記録の週」を検出し、task_progress_history を遡って
過去の正確な進捗を復元したスナップショットを記録する。

基準日: 毎週月曜日
"""
from datetime import date, datetime, timedelta, time
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

from .. import models


def _week_monday(d: date) -> date:
    """日付 d を含む週の月曜日を返す（月曜=0, 日曜=6）"""
    return d - timedelta(days=d.weekday())


def _next_monday(d: date) -> date:
    """日付 d より後の最も近い月曜日を返す（d自身は含まない）"""
    days_until_next_monday = (7 - d.weekday()) % 7
    if days_until_next_monday == 0:
        days_until_next_monday = 7
    return d + timedelta(days=days_until_next_monday)


def _previous_or_same_monday(d: date) -> date:
    """日付 d 以前で最も近い月曜日（d が月曜なら d 自身）"""
    return d - timedelta(days=d.weekday())


def _list_target_mondays(start_monday: date, today: date) -> List[date]:
    """start_monday から today まで（today 当日は含まない）の月曜日を列挙"""
    # 今日が月曜なら今日のスナップショットは生成しない（その週はまだ始まったばかり）
    # → 今日より前の月曜日まで
    last_target = _previous_or_same_monday(today)
    if last_target == today:
        last_target = today - timedelta(days=7)

    result = []
    cur = start_monday
    while cur <= last_target:
        result.append(cur)
        cur += timedelta(days=7)
    return result


def _get_task_progress_at(
    db: Session, task_id: int, target_dt: datetime
) -> Optional[int]:
    """指定日時点でのタスクの進捗を task_progress_history から復元。
    target_dt 以前で最新の履歴を取得。履歴がなければ None を返す。"""
    history = (
        db.query(models.TaskProgressHistory)
        .filter(
            models.TaskProgressHistory.task_id == task_id,
            models.TaskProgressHistory.changed_at <= target_dt,
        )
        .order_by(models.TaskProgressHistory.changed_at.desc())
        .first()
    )
    return history.progress if history else None


def _generate_snapshot_for_date(
    db: Session, project_id: int, snapshot_date: date
) -> models.ProgressSnapshot:
    """指定プロジェクト・日付のスナップショットを task_progress_history から復元して作成。
    全タスクを対象とし、基準日時点で履歴がないタスクは progress=0 として記録する。"""
    # 基準日の終端（その日の終わり）
    target_dt = datetime.combine(snapshot_date, time(23, 59, 59))

    snapshot = models.ProgressSnapshot(
        project_id=project_id, snapshot_date=snapshot_date
    )
    db.add(snapshot)
    db.flush()

    # プロジェクト配下の全タスクを対象（作成日時で絞らない）
    tasks = (
        db.query(models.Task)
        .filter(models.Task.project_id == project_id)
        .all()
    )

    for task in tasks:
        progress = _get_task_progress_at(db, task.id, target_dt)
        # 履歴がなければ 0 として記録
        if progress is None:
            progress = 0
        db.add(models.SnapshotTaskProgress(
            snapshot_id=snapshot.id,
            task_id=task.id,
            progress=progress,
        ))

    return snapshot


def generate_missing_snapshots_for_project(
    db: Session, project: models.Project, today: Optional[date] = None
) -> List[date]:
    """1プロジェクトの未記録週スナップショットを生成。生成した日付リストを返す。"""
    if today is None:
        today = date.today()

    # 起点日の決定
    latest_snap = (
        db.query(models.ProgressSnapshot)
        .filter(models.ProgressSnapshot.project_id == project.id)
        .order_by(models.ProgressSnapshot.snapshot_date.desc())
        .first()
    )

    if latest_snap:
        # 既にスナップショットがある → その翌週月曜日から
        start_monday = _next_monday(latest_snap.snapshot_date)
    else:
        # まだスナップショットがない → 最古タスクの開始日を含む週の月曜日から
        earliest_task = (
            db.query(models.Task)
            .filter(models.Task.project_id == project.id)
            .order_by(models.Task.start_date.asc())
            .first()
        )
        if not earliest_task:
            # タスクすらない → 生成不要
            return []
        start_monday = _week_monday(earliest_task.start_date)

    target_mondays = _list_target_mondays(start_monday, today)

    generated = []
    for monday in target_mondays:
        _generate_snapshot_for_date(db, project.id, monday)
        generated.append(monday)

    return generated


def generate_missing_snapshots_all(
    db: Session, today: Optional[date] = None
) -> dict:
    """全プロジェクトの未記録週スナップショットを生成。
    結果サマリを {project_id: [生成された日付,...]} で返す。"""
    if today is None:
        today = date.today()

    summary = {}
    projects = db.query(models.Project).all()
    for project in projects:
        generated = generate_missing_snapshots_for_project(db, project, today)
        if generated:
            summary[project.id] = generated

    db.commit()
    return summary
