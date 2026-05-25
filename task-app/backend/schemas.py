"""Pydantic スキーマ（リクエスト/レスポンス型）"""
from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator


# ===== Project =====

class ProjectBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_completed: bool = False

    @model_validator(mode="after")
    def _check_date_range(self):
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError("start_date must be <= end_date")
        return self


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(ProjectBase):
    pass


class ProjectOut(ProjectBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner_id: int
    created_at: datetime
    updated_at: datetime
    # タスクから算出した実効的な開始日・終了日（手動設定値があればそれを優先）
    effective_start_date: Optional[date] = None
    effective_end_date: Optional[date] = None


# ===== Member =====

class MemberBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str = Field(default="#888888", pattern=r"^#[0-9A-Fa-f]{6}$")


class MemberCreate(MemberBase):
    pass


class MemberUpdate(MemberBase):
    pass


class MemberOut(MemberBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime


# ===== Task =====

class TaskBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: date
    end_date: date
    progress: int = Field(default=0, ge=0, le=100)
    is_milestone: bool = False
    parent_task_id: Optional[int] = None
    assignee_id: Optional[int] = None

    @model_validator(mode="after")
    def _check_date_range(self):
        if self.start_date > self.end_date:
            raise ValueError("start_date must be <= end_date")
        return self


class TaskCreate(TaskBase):
    pass


class TaskUpdate(TaskBase):
    pass


class TaskOut(TaskBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    created_at: datetime
    updated_at: datetime


class TaskWithChildren(TaskOut):
    """階層表示用：子タスクをネストして返す"""
    children: List["TaskWithChildren"] = []


# ===== Progress History =====

class ProgressHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_id: int
    progress: int
    changed_at: datetime


# ===== Snapshot =====

class SnapshotTaskProgressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    task_id: int
    progress: int


class SnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    snapshot_date: date
    created_at: datetime
    task_progresses: List[SnapshotTaskProgressOut] = []


class SnapshotCreate(BaseModel):
    """手動スナップショット作成（日付指定可）"""
    snapshot_date: Optional[date] = None  # 未指定なら今日
