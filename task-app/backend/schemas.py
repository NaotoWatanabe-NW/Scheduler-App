"""Pydantic スキーマ（リクエスト/レスポンス型）"""
from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator


# ===== Auth =====

class AuthRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=4, max_length=200)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str


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


# ===== Portfolio (統合プロジェクト) =====

class PortfolioCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    project_ids: List[int] = []


class PortfolioUpdate(PortfolioCreate):
    pass


class PortfolioOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    project_ids: List[int] = []


class PortfolioProjectSummary(BaseModel):
    """統合ビュー用のプロジェクト集計（1プロジェクト=1バー）"""
    project_id: int
    name: str
    is_completed: bool
    start_date: Optional[date] = None      # 配下タスクの最早開始日
    end_date: Optional[date] = None        # 配下タスクの最遅終了日
    task_count: int                        # 末端タスク数
    progress_percent: Optional[int] = None  # バー上の進捗点位置（期間に対する%）
    delay_days: Optional[int] = None       # 正=遅延日数 / 0=順調 / 負=先行日数
    bottleneck_task: Optional[str] = None  # 最も遅れているタスク名


class PortfolioSummaryOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    base_date: date                        # イナヅマ基準日（今日）
    projects: List[PortfolioProjectSummary] = []


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


# ===== Task Move =====

class TaskMoveRequest(BaseModel):
    target_project_id: int


# ===== Task Dependency =====

class DependencyCreate(BaseModel):
    predecessor_id: int
    successor_id: int


class DependencyOut(DependencyCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ===== Task Template =====

class TemplateItemIn(BaseModel):
    """テンプレート内タスク定義（ネスト可）。
    key はリクエスト内でアイテムを識別するクライアント任意の文字列（依存関係の参照用）。"""
    key: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    duration_days: int = Field(default=1, ge=1)
    children: List["TemplateItemIn"] = []


class TemplateItemOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    duration_days: int
    children: List["TemplateItemOut"] = []


class TemplateDependencyIn(BaseModel):
    """アイテム間の依存（key で参照）"""
    predecessor_key: str
    successor_key: str


class TemplateDependencyOut(BaseModel):
    predecessor_id: int  # テンプレートアイテムID
    successor_id: int


class TemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    items: List[TemplateItemIn] = []
    dependencies: List[TemplateDependencyIn] = []


class TemplateUpdate(TemplateCreate):
    pass


class TemplateOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    items: List[TemplateItemOut] = []
    dependencies: List[TemplateDependencyOut] = []


class ApplyTemplateRequest(BaseModel):
    """テンプレート適用。
    start_date 指定 → 開始日から前方に計算 / end_date 指定 → 終了日から逆算。
    どちらか一方のみ指定する。"""
    template_id: int
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    skip_non_working: bool = True  # 土日祝を除いて日程計算する

    @model_validator(mode="after")
    def _check_anchor(self):
        if (self.start_date is None) == (self.end_date is None):
            raise ValueError("Specify exactly one of start_date or end_date")
        return self
