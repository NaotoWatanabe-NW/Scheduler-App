"""SQLAlchemy ORM モデル"""
from datetime import datetime, date
from sqlalchemy import (
    Column, Integer, String, Text, Date, DateTime, Boolean,
    ForeignKey, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .database import Base


class User(Base):
    """ユーザー（認証用）"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)  # "salt$hash" (PBKDF2)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class UserSession(Base):
    """ログインセッション（Cookieトークン）"""
    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    expires_at = Column(DateTime, nullable=False)

    user = relationship("User")


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


class PortfolioProject(Base):
    """統合プロジェクト（複数プロジェクトの進捗をまとめて表示する閲覧専用ビュー）"""
    __tablename__ = "portfolio_projects"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, nullable=False, default=1)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    items = relationship(
        "PortfolioProjectItem", back_populates="portfolio",
        cascade="all, delete-orphan",
    )


class PortfolioProjectItem(Base):
    """統合プロジェクトに含まれるプロジェクト"""
    __tablename__ = "portfolio_project_items"
    __table_args__ = (
        UniqueConstraint("portfolio_id", "project_id", name="uq_portfolio_project"),
    )

    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(
        Integer, ForeignKey("portfolio_projects.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    project_id = Column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    order_index = Column(Integer, nullable=False, default=0)

    portfolio = relationship("PortfolioProject", back_populates="items")
    project = relationship("Project")


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


class TaskDependency(Base):
    """タスク依存関係（先行タスクが終わってから後続タスクを行う）"""
    __tablename__ = "task_dependencies"
    __table_args__ = (
        UniqueConstraint("predecessor_id", "successor_id", name="uq_dependency_pair"),
    )

    id = Column(Integer, primary_key=True, index=True)
    predecessor_id = Column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    successor_id = Column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class TaskTemplate(Base):
    """タスクテンプレート（定型のタスク一式）"""
    __tablename__ = "task_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    items = relationship(
        "TaskTemplateItem", back_populates="template", cascade="all, delete-orphan"
    )


class TaskTemplateItem(Base):
    """テンプレート内のタスク定義（階層＋必要日数）"""
    __tablename__ = "task_template_items"

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(
        Integer, ForeignKey("task_templates.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    parent_item_id = Column(
        Integer, ForeignKey("task_template_items.id", ondelete="CASCADE"), nullable=True
    )
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    duration_days = Column(Integer, nullable=False, default=1)  # 必要日数（営業日）
    order_index = Column(Integer, nullable=False, default=0)    # 同階層内の並び順

    template = relationship("TaskTemplate", back_populates="items")
    parent = relationship("TaskTemplateItem", remote_side=[id], backref="children")


class TemplateItemDependency(Base):
    """テンプレート内アイテムの依存関係（先行→後続）。
    適用時にタスクの依存関係（task_dependencies）としてコピーされる。"""
    __tablename__ = "template_item_dependencies"
    __table_args__ = (
        UniqueConstraint(
            "predecessor_item_id", "successor_item_id", name="uq_tpl_dependency_pair"
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(
        Integer, ForeignKey("task_templates.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    predecessor_item_id = Column(
        Integer, ForeignKey("task_template_items.id", ondelete="CASCADE"), nullable=False
    )
    successor_item_id = Column(
        Integer, ForeignKey("task_template_items.id", ondelete="CASCADE"), nullable=False
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
