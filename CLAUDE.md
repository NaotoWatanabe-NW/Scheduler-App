# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gantt chart + Inazuma line (progress trend) project management tool. FastAPI backend with vanilla JavaScript/SVG frontend. Single-user app with multi-user (`owner_id`) scaffolding already in place.

## Running the App

```bash
# Linux/macOS (from repo root)
./start.sh

# Or manually (from task-app/)
pip install -r requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 18234
```

Access at http://localhost:18234. API docs at http://localhost:18234/docs.

The SQLite database is auto-created at `task-app/data/tasks.db` on first run.

## Architecture

```
task-app/
├── backend/
│   ├── main.py               # App entry, startup snapshot reconstruction
│   ├── database.py           # SQLAlchemy engine, FK pragma, auto-migrations
│   ├── models.py             # ORM: Project, Task, Member, ProgressSnapshot
│   ├── schemas.py            # Pydantic request/response schemas
│   ├── routers/
│   │   ├── projects.py       # Project CRUD
│   │   ├── tasks.py          # Task CRUD + hierarchy builder + progress history
│   │   ├── members.py        # Member CRUD
│   │   └── snapshots.py      # Snapshot CRUD (auto-overwrite same date)
│   └── services/
│       └── snapshot_service.py  # Weekly snapshot auto-generation from history
└── frontend/
    ├── js/
    │   ├── gantt.js          # SVG Gantt rendering engine (custom, no lib)
    │   ├── project.js        # Gantt page controller
    │   ├── api.js            # Fetch wrapper
    │   ├── editor.js         # Task edit modal
    │   ├── snapshots.js      # Snapshot management modal
    │   └── todo.js / members.js / index.js / util.js
    └── css/style.css
```

## Key Architectural Patterns

**Snapshot reconstruction**: On startup, `snapshot_service.py` scans for missing weekly Monday snapshots and rebuilds them from `task_progress_history`. This means no external cron job is needed — just restarting the app catches up.

**Progress history**: Every `PUT /api/tasks/{id}` that changes `progress` appends a row to `task_progress_history`. Snapshots are reconstructed from this table, not stored independently, so history is the source of truth.

**Hierarchical tasks**: Tasks have `parent_id`. The `tasks.py` router builds a tree on every list request with cycle detection. Changing a parent recalculates tree positions.

**SVG Gantt engine**: `gantt.js` renders the entire chart declaratively — all data flows to layout, then layout to SVG elements. Supports day/week/month zoom levels. Inazuma lines are drawn by connecting progress-bar positions across snapshots.

**Auth-ready, single-user now**: All models have `owner_id` (hardcoded `CURRENT_OWNER_ID = 1` in routers). To enable multi-tenancy, replace with `Depends(get_current_user)`.

## Data Model

- `projects` → has many `tasks`, `members` (through assignment), `progress_snapshots`
- `tasks` → self-referential (`parent_id`), many-to-one `members`, has many `task_progress_history`
- `progress_snapshots` → has many `snapshot_task_progress` (detail rows per task)
- `task_progress_history` → append-only log; source for snapshot reconstruction

## API Endpoints

```
GET/POST        /api/projects
GET/PUT/DELETE  /api/projects/{id}
GET/POST        /api/projects/{id}/tasks
GET/PUT/DELETE  /api/tasks/{id}
GET             /api/tasks/{id}/history
GET             /api/tasks/todo              # Cross-project tasks due today
GET/POST        /api/projects/{id}/snapshots
DELETE          /api/projects/{id}/snapshots/{snap_id}
GET/POST/PUT/DELETE  /api/members/{...}
GET             /api/health
```

## No Test Suite

There is currently no automated test setup. Manual testing via Swagger UI at `/docs`.
