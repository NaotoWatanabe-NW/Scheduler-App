"""SQLAlchemy ORM モデル"""
from datetime import datetime, date
from sqlalchemy import (
    Column, Integer, String, Text, Date, DateTime, Boolean,
    ForeignKey,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .database import Base


class Project(Base):
    """プロジェクト"""
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, nullable=False, default=1)  # 将来の認証用
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    start_date = Column(Date, nullable=True)  # 任意：未設定ならタスクから自動算出
    end_date = Column(Date, nullable=True)
    is_completed = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    tasks = relationship(
        "Task", back_populates="project", cascade="all, delete-orphan"
    )
    snapshots = relationship(
        "ProgressSnapshot", back_populates="project", cascade="all, delete-orphan"
    )


class Member(Base):
    """メンバー（担当者）"""
    __tablename__ = "members"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    color = Column(String(7), nullable=False, default="#888888")  # #RRGGBB
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    tasks = relationship("Task", back_populates="assignee")


class Task(Base):
    """タスク"""
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    parent_task_id = Column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
    )
    assignee_id = Column(
        Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True
    )
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    progress = Column(Integer, nullable=False, default=0)  # 0-100
    is_milestone = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    project = relationship("Project", back_populates="tasks")
    assignee = relationship("Member", back_populates="tasks")
    parent = relationship("Task", remote_side=[id], backref="children")
    progress_history = relationship(
        "TaskProgressHistory",
        back_populates="task",
        cascade="all, delete-orphan",
    )


class TaskProgressHistory(Base):
    """進捗履歴（スナップショット復元の根拠データ）"""
    __tablename__ = "task_progress_history"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    progress = Column(Integer, nullable=False)
    changed_at = Column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )

    task = relationship("Task", back_populates="progress_history")


class ProgressSnapshot(Base):
    """イナヅマ線ヘッダ"""
    __tablename__ = "progress_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    snapshot_date = Column(Date, nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    project = relationship("Project", back_populates="snapshots")
    task_progresses = relationship(
        "SnapshotTaskProgress",
        back_populates="snapshot",
        cascade="all, delete-orphan",
    )


class SnapshotTaskProgress(Base):
    """イナヅマ線明細（基準日時点での各タスク進捗）"""
    __tablename__ = "snapshot_task_progress"
    # task_id 経由のカスケード削除でORM側の整合チェックが過剰反応する警告を抑制
    __mapper_args__ = {"confirm_deleted_rows": False}

    id = Column(Integer, primary_key=True, index=True)
    snapshot_id = Column(
        Integer, ForeignKey("progress_snapshots.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    task_id = Column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    progress = Column(Integer, nullable=False)

    snapshot = relationship("ProgressSnapshot", back_populates="task_progresses")
