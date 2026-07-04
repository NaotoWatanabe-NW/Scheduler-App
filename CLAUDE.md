# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gantt chart + Inazuma line (progress trend) project management tool. FastAPI backend with vanilla JavaScript/SVG frontend. Multi-user with session-cookie authentication; projects are scoped per user (`owner_id`), while members and templates are shared globally.

## Running the App

```bash
# Linux/macOS (script lives in task-app/, works from any cwd)
./task-app/start.sh
# Windows
task-app\start.bat

# Or manually (from task-app/)
pip install -r requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 18234
```

Access at <http://localhost:18234>. API docs at <http://localhost:18234/docs>.

The SQLite database is auto-created at `task-app/data/tasks.db` on first run.

## Architecture

```text
task-app/
├── backend/
│   ├── main.py               # App entry, startup snapshot reconstruction, auth-required router registration
│   ├── database.py           # SQLAlchemy engine, FK pragma, auto-migrations
│   ├── models.py             # ORM: User, UserSession, Project, Task, Member, TaskDependency,
│   │                         #      TaskTemplate(+items, item deps), ProgressSnapshot
│   ├── schemas.py            # Pydantic request/response schemas
│   ├── routers/
│   │   ├── auth.py           # Register/login/logout/me (session cookie)
│   │   ├── projects.py       # Project CRUD (owner-scoped)
│   │   ├── tasks.py          # Task CRUD + hierarchy + progress history + parent auto-progress
│   │   ├── members.py        # Member CRUD (global)
│   │   ├── snapshots.py      # Snapshot CRUD (auto-overwrite same date)
│   │   ├── dependencies.py   # Task dependency CRUD (cycle detection)
│   │   ├── templates.py      # Template CRUD + apply (forward/backward scheduling)
│   │   └── portfolios.py     # Portfolio (統合プロジェクト) CRUD + rollup summary
│   └── services/
│       ├── auth_service.py   # PBKDF2 hashing, sessions, get_current_user, get_owned_project
│       ├── snapshot_service.py  # Weekly snapshot auto-generation from history
│       └── jp_holidays.py    # Japanese holidays + working-day math (Python twin of util.js)
└── frontend/
    ├── login.html / index.html / project.html / members.html / todo.html
    ├── templates.html / flow.html / portfolios.html / portfolio_view.html
    ├── js/
    │   ├── gantt.js          # SVG Gantt engine (bars, drag-to-move/resize, dep arrows, shading)
    │   ├── project.js        # Gantt page controller (filters, PNG export, apply-template dialog)
    │   ├── flow.js           # Dependency flowchart (DAG layering, PNG export)
    │   ├── templates.js      # Template editor (items + predecessor chips)
    │   ├── api.js            # Fetch wrapper (401 → /login redirect)
    │   ├── editor.js         # Task edit modal + move dialog + predecessor management
    │   ├── snapshots.js      # Snapshot management modal
    │   ├── login.js          # Login/register page
    │   └── todo.js / members.js / index.js / util.js (dates, holidays, delay calc, SVG→PNG)
    └── css/style.css
```

## Key Architectural Patterns

**Snapshot reconstruction**: On startup, `snapshot_service.py` scans for missing weekly Monday snapshots and rebuilds them from `task_progress_history`. This means no external cron job is needed — just restarting the app catches up.

**Progress history**: Every `PUT /api/tasks/{id}` that changes `progress` appends a row to `task_progress_history`. Snapshots are reconstructed from this table, not stored independently, so history is the source of truth.

**Hierarchical tasks**: Tasks have `parent_task_id`. The `tasks.py` router builds a tree on every list request (sorted by `start_date` within each level) with cycle detection on parent changes. `POST /api/tasks/{id}/move` moves a task and all descendants to another project, clearing the moved root's parent and severing dependencies that would cross projects.

**Parent auto-progress**: A parent task's `progress` is derived — `_recompute_ancestor_progress()` in `tasks.py` sets it to the rounded average of its direct children and cascades upward on every child create/update/delete/move (all children 100% ⇒ parent 100% = complete). It must `db.flush()` after each level because the session has `autoflush=False`. The editor disables the progress input for tasks with children.

**Authentication**: Session-cookie auth (`session_token`, HttpOnly, 30 days) backed by `user_sessions`. Passwords are PBKDF2-HMAC-SHA256 (stdlib only). `main.py` registers every router except `auth` with `dependencies=[Depends(get_current_user)]`; ownership checks use `get_owned_project()` / `_get_owned_task()` (return 404, not 403). Pre-auth data (owner_id=1) belongs to the first registered user. Frontend: `api.js` redirects to `/login` on 401; `util.js` injects the username/logout widget into the header nav on every page.

**Task dependencies**: `task_dependencies` (predecessor→successor, same project only) with BFS cycle detection on create. Gantt draws elbow arrows between visible bars; `flow.html` renders the DAG as a flowchart (longest-path layering). Managed per task in the edit modal ("先行タスク").

**Templates**: `task_templates` + nested `task_template_items` (duration in working days) + `template_item_dependencies`. Apply (`POST /api/projects/{id}/apply-template`) schedules leaves topologically — parallel when dependencies allow, serial when none — anchored at `start_date` (forward) or `end_date` (backward), optionally skipping weekends/holidays; item deps are copied to task deps. Item references in create/update payloads use client-side `key` strings.

**Japanese holidays — duplicated algorithm**: identical holiday math lives in `frontend/js/util.js` (`jpHolidays`) and `backend/services/jp_holidays.py` (valid 1980–2099, includes substitute/citizens' holidays). **Keep both in sync when editing.**

**Delay detection (frontend-only)**: `util.plannedProgress()` = elapsed days (excluding today) / duration; a leaf task is delayed when actual < planned. Drives red bar outlines in gantt, ⚠ in the task list, and 遅延 badges in ToDo.

**SVG Gantt engine**: `gantt.js` renders the entire chart declaratively — all data flows to layout, then layout to SVG elements. Supports day/week/month zoom levels, a today line, weekend/holiday shading (day+week views), drag-to-move/resize bars (ghost preview, `onTaskUpdate` callback does the PUT), and dependency arrows. Inazuma lines are drawn by connecting progress-bar positions across snapshots.

**PNG export**: `util.svgToCanvas()` serializes the SVG (inlining a font-family since standalone SVG loses page CSS) and rasterizes at 2×. The gantt export composes a canvas-drawn left pane (task names/assignee/progress) next to the chart.

**Portfolio rollup (統合プロジェクト)**: read-only multi-project gantt. `portfolios.py` summary computes, per project, the bar span (min/max leaf-task dates) and a progress point = the **most-delayed attainment date** (task start + duration × progress%) among incomplete leaf tasks, with not-yet-due tasks pinned to today (= on schedule); `delay_days` = today − attainment. `portfolio_view.js` maps each project to a pseudo-task and the progress points to a single pseudo-snapshot (base date = today) so `gantt.js` renders it unchanged — no drag (no `onTaskUpdate`), clicks navigate to the project page.

**Lightweight migrations**: `database.py:_apply_migrations()` runs `ALTER TABLE` on startup for missing columns (no Alembic); new tables are created automatically by `create_all`. Add new columns there.

**Project completion**: `projects.is_completed` hides projects from the default list (`?include_completed=true` to include) and excludes their tasks from `/api/tasks/todo`. Completed tasks (progress 100%) are hidden in the gantt by default (toggle button, persisted in localStorage).

## Data Model

- `users` → has many `user_sessions`, owns `projects` and `portfolio_projects` (`owner_id`)
- `projects` → has many `tasks`, `progress_snapshots`; scoped per user
- `portfolio_projects` → has many `portfolio_project_items` (ordered refs to projects; cascade on project delete)
- `members` → global (shared across users); referenced by `tasks.assignee_id`
- `tasks` → self-referential (`parent_task_id`), many-to-one `members`, has many `task_progress_history`
- `task_dependencies` → predecessor/successor task pairs (same project, acyclic)
- `task_templates` → has many `task_template_items` (self-referential tree, `duration_days`, `order_index`) and `template_item_dependencies`
- `progress_snapshots` → has many `snapshot_task_progress` (detail rows per task)
- `task_progress_history` → append-only log; source for snapshot reconstruction

## API Endpoints

All routes except `/api/auth/*` and `/api/health` require a session cookie (401 otherwise).

```text
POST            /api/auth/register|login|logout ; GET /api/auth/me
GET/POST        /api/projects                # GET: ?include_completed=true (owner-scoped)
GET/PUT/DELETE  /api/projects/{id}
GET/POST        /api/projects/{id}/tasks
GET/PUT/DELETE  /api/tasks/{id}              # PUT recomputes ancestor progress
POST            /api/tasks/{id}/move         # Move task + descendants to another project
GET             /api/tasks/{id}/history
GET             /api/tasks/todo              # Cross-project actionable tasks (?assignee_id=/?project_id=)
GET/POST        /api/projects/{id}/dependencies ; DELETE /api/dependencies/{dep_id}
GET/POST        /api/templates ; GET/PUT/DELETE /api/templates/{id}
POST            /api/projects/{id}/apply-template  # start_date (forward) or end_date (backward)
GET/POST        /api/portfolios ; GET/PUT/DELETE /api/portfolios/{id}
GET             /api/portfolios/{id}/summary  # Rollup for the integrated gantt view
GET/POST        /api/projects/{id}/snapshots
DELETE          /api/projects/{id}/snapshots/{snap_id}
GET/POST/PUT/DELETE  /api/members/{...}
GET             /api/health
```

Frontend pages: `/` `/projects/{id}` `/projects/{id}/flow` `/portfolios` `/portfolios/{id}` `/todo` `/members` `/templates` `/login`.

## No Test Suite

There is currently no automated test setup. Manual testing via Swagger UI at `/docs`.
