// プロジェクト画面コントローラ
//
// 設計原則: 全ての状態変更は loadAndRender() を呼んでデータ再取得＋全再描画。

const projectId = util.pathId("/projects");

// localStorage の折りたたみ状態キー（プロジェクトごとに別管理）
const COLLAPSED_STORAGE_KEY = `taskapp:collapsed:project:${projectId}`;

function loadCollapsedFromStorage() {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(Number) : []);
  } catch (e) {
    console.warn("Failed to load collapsed state:", e);
    return new Set();
  }
}

function saveCollapsedToStorage(set) {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch (e) {
    console.warn("Failed to save collapsed state:", e);
  }
}

// 状態
const state = {
  project: null,
  tasks: [],          // フラットなタスクリスト（編集モーダル用）
  taskTree: [],       // 階層化されたツリー（描画用）
  snapshots: [],
  members: [],
  // ビュー設定
  zoomLevel: "week",
  showInazuma: true,
  snapshotCount: 4,
  // フェーズ6: フィルタ・折りたたみ（localStorage から復元）
  collapsedTaskIds: loadCollapsedFromStorage(),
  assigneeFilter: null,             // null=全員 / member_id=絞り込み / 0=未割当のみ
};

// ===== データ取得 =====

async function loadData() {
  const [project, taskTree, snapshots, members] = await Promise.all([
    api.get(`/projects/${projectId}`),
    api.get(`/projects/${projectId}/tasks`),
    api.get(`/projects/${projectId}/snapshots`),
    api.get("/members"),
  ]);
  state.project = project;
  state.taskTree = taskTree;
  state.tasks = flattenTree(taskTree);
  state.snapshots = snapshots;
  state.members = members;
}

function flattenTree(tree) {
  const result = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      result.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree);
  return result;
}

/**
 * フィルタと折りたたみを適用して、表示用のツリーを返す。
 * - 担当者フィルタ: タスク本体または子孫が一致するもののみ残す
 * - 折りたたみ: collapsedTaskIds に含まれる親の子を切り捨てる
 *
 * 親タスクは「子の少なくとも1つがフィルタに合致」していれば残す（階層保持）。
 */
function getVisibleTree() {
  const filter = state.assigneeFilter;
  const collapsed = state.collapsedTaskIds;

  const matchesFilter = (task) => {
    if (filter === null) return true;
    if (filter === 0) return task.assignee_id == null;
    return task.assignee_id === filter;
  };

  const buildSubtree = (node) => {
    // 子をまず再帰的に処理
    const isCollapsed = collapsed.has(node.id);
    const visibleChildren = isCollapsed
      ? []  // 折りたたまれているので子は表示しない
      : node.children
          .map(buildSubtree)
          .filter(Boolean);

    // 子孫マッチ判定はオリジナルのchildrenを使う
    const hasMatchingDescendant = (function check(n) {
      if (matchesFilter(n)) return true;
      return n.children.some(check);
    })(node);

    if (!hasMatchingDescendant && !matchesFilter(node)) return null;

    return {
      ...node,
      children: visibleChildren,
      // 折りたたみトグル判定用：元の子の有無を保持
      // （折りたたんだ後でも親判定できるようにする）
      _hasChildren: node.children.length > 0,
    };
  };

  return state.taskTree.map(buildSubtree).filter(Boolean);
}

// ===== 表示範囲の決定 =====

function getViewRange() {
  // バックエンドが計算した effective_start_date / effective_end_date を優先利用
  let start = state.project.effective_start_date
    ? util.parseDate(state.project.effective_start_date) : null;
  let end = state.project.effective_end_date
    ? util.parseDate(state.project.effective_end_date) : null;

  // それでも決まらない場合（タスクなし・手動設定なし）は今日基準で前後14日
  if (!start) start = util.addDays(util.today(), -7);
  if (!end) end = util.addDays(util.today(), 14);

  // スナップショット日が表示範囲外にある場合に備えて、範囲を拡張
  for (const snap of state.snapshots.slice(0, state.snapshotCount)) {
    const d = util.parseDate(snap.snapshot_date);
    if (d < start) start = d;
    if (d > end) end = d;
  }

  // 少し余白
  start = util.addDays(start, -3);
  end = util.addDays(end, 3);

  return { viewStart: start, viewEnd: end };
}

// ===== 描画 =====

function render() {
  // プロジェクトタイトル
  document.getElementById("project-title").textContent = state.project.name;
  const effStart = state.project.effective_start_date;
  const effEnd = state.project.effective_end_date;
  const period = (effStart || "未設定") + " 〜 " + (effEnd || "未設定");
  const isAuto = (!state.project.start_date || !state.project.end_date) && (effStart || effEnd);
  document.getElementById("project-period").textContent =
    `期間: ${period}${isAuto ? "（自動算出）" : ""}`;

  // 担当者フィルタの選択肢を更新
  renderAssigneeFilter();

  // 表示範囲決定
  const { viewStart, viewEnd } = getViewRange();

  // フィルタ・折りたたみを適用したツリー
  const visibleTree = getVisibleTree();

  // 左ペイン: タスクリスト
  renderTaskList(visibleTree);

  // 右ペイン: ガントチャート
  const chartContainer = document.getElementById("gantt-chart");
  gantt.renderGantt(chartContainer, visibleTree, state.snapshots, state.members, {
    zoomLevel: state.zoomLevel,
    viewStart,
    viewEnd,
    showInazuma: state.showInazuma,
    snapshotCount: state.snapshotCount,
    onTaskClick: (taskWithLayout) => {
      const original = state.tasks.find(t => t.id === taskWithLayout.id);
      if (original) openTaskEditor(original);
    },
  });

  // 左ペインのスクロールを右ペインと同期
  setupPaneSync();
}

function renderTaskList(visibleTree) {
  const container = document.getElementById("task-rows");
  const flatList = flattenTreeWithDepth(visibleTree);

  if (flatList.length === 0) {
    const message = state.tasks.length === 0
      ? "タスクがありません"
      : "条件に合うタスクがありません";
    container.innerHTML = `<div class="empty-state" style="padding:24px;">${message}</div>`;
    return;
  }

  const memberMap = {};
  state.members.forEach(m => { memberMap[m.id] = m; });

  container.innerHTML = flatList.map(({ task, depth, hasChildren }) => {
    const nameClasses = ["gantt-task-row__name"];
    if (hasChildren) nameClasses.push("gantt-task-row__name--parent");
    if (task.is_milestone) nameClasses.push("gantt-task-row__name--milestone");

    const assignee = task.assignee_id && memberMap[task.assignee_id]
      ? memberMap[task.assignee_id]
      : null;
    const assigneeHtml = assignee
      ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${assignee.color};margin-right:4px;vertical-align:middle"></span>${util.escapeHtml(assignee.name)}`
      : "<span style='color:#bbb'>—</span>";

    const indent = depth * gantt.LAYOUT.CHILD_INDENT;

    // 親タスクには折りたたみトグルを表示
    let toggleHtml = "";
    if (hasChildren) {
      const isCollapsed = state.collapsedTaskIds.has(task.id);
      const symbol = isCollapsed ? "▶" : "▼";
      const aria = isCollapsed ? "展開" : "折りたたみ";
      toggleHtml = `<button type="button" class="task-toggle" data-toggle="${task.id}" aria-label="${aria}" title="${aria}">${symbol}</button>`;
    } else {
      toggleHtml = `<span class="task-toggle-spacer"></span>`;
    }

    // タスク名部分だけクリック対象にする
    return `
      <div class="gantt-task-row">
        <div class="${nameClasses.join(" ")}" style="padding-left:${indent}px">
          ${toggleHtml}<span class="task-name-text" data-task-id="${task.id}">${util.escapeHtml(task.name)}</span>
        </div>
        <div class="gantt-task-row__assignee" data-task-id="${task.id}">${assigneeHtml}</div>
        <div class="gantt-task-row__progress" data-task-id="${task.id}">${hasChildren ? "—" : task.progress + "%"}</div>
      </div>
    `;
  }).join("");

  // 折りたたみトグルのクリック
  container.querySelectorAll("[data-toggle]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.toggle);
      if (state.collapsedTaskIds.has(id)) {
        state.collapsedTaskIds.delete(id);
      } else {
        state.collapsedTaskIds.add(id);
      }
      saveCollapsedToStorage(state.collapsedTaskIds);
      render();
    });
  });

  // タスク名・担当・進捗のクリックで編集モーダル（トグルとは独立）
  container.querySelectorAll("[data-task-id]").forEach(el => {
    el.addEventListener("click", () => {
      const id = Number(el.dataset.taskId);
      const t = state.tasks.find(x => x.id === id);
      if (t) openTaskEditor(t);
    });
  });
}

function flattenTreeWithDepth(tree, depth = 0) {
  const result = [];
  for (const node of tree) {
    // _hasChildren があればそれを使う（折りたたまれていても元の子の有無を保持）
    const hasChildren = node._hasChildren !== undefined
      ? node._hasChildren
      : node.children.length > 0;
    result.push({ task: node, depth, hasChildren });
    if (node.children.length > 0) {
      result.push(...flattenTreeWithDepth(node.children, depth + 1));
    }
  }
  return result;
}

// 担当者フィルタの選択肢を更新
function renderAssigneeFilter() {
  const select = document.getElementById("assignee-filter");
  if (!select) return;

  const currentValue = select.value;
  select.innerHTML = `
    <option value="all">全担当者</option>
    <option value="unassigned">未割当のみ</option>
    ${state.members.map(m => `<option value="${m.id}">${util.escapeHtml(m.name)}</option>`).join("")}
  `;

  // 選択状態を復元
  if (state.assigneeFilter === null) {
    select.value = "all";
  } else if (state.assigneeFilter === 0) {
    select.value = "unassigned";
  } else {
    select.value = String(state.assigneeFilter);
  }
}

// ===== 左右ペインのスクロール同期 =====

function setupPaneSync() {
  const left = document.querySelector(".gantt-task-pane");
  const right = document.querySelector(".gantt-chart-pane");
  if (!left || !right) return;
  // 既存リスナを除去するため、一度クローンする必要はないが、フラグで多重登録防止
  if (left._syncSetup) return;
  left._syncSetup = true;

  let syncing = false;
  left.addEventListener("scroll", () => {
    if (syncing) { syncing = false; return; }
    syncing = true;
    right.scrollTop = left.scrollTop;
  });
  right.addEventListener("scroll", () => {
    if (syncing) { syncing = false; return; }
    syncing = true;
    left.scrollTop = right.scrollTop;
  });
}

// ===== 全再描画 =====

async function loadAndRender() {
  try {
    await loadData();
    render();
  } catch (e) {
    util.toast("読み込みエラー: " + e.message);
    console.error(e);
  }
}

// ===== タスク編集 =====

function openTaskEditor(task) {
  openTaskModal({
    projectId,
    task,
    allTasks: state.tasks,
    members: state.members,
    onSaved: loadAndRender,
  });
}

// ===== イベント =====

document.getElementById("btn-new-task").addEventListener("click", () => {
  openTaskModal({
    projectId,
    task: null,
    allTasks: state.tasks,
    members: state.members,
    onSaved: loadAndRender,
  });
});

document.getElementById("btn-snapshot").addEventListener("click", async () => {
  if (!util.confirm("現在の進捗で本日のスナップショットを作成しますか？\n（同日のスナップショットがあれば上書きされます）")) return;
  try {
    await api.post(`/projects/${projectId}/snapshots`, {});
    util.toast("スナップショットを作成しました");
    loadAndRender();
  } catch (e) {
    util.toast("作成エラー: " + e.message);
  }
});

document.getElementById("btn-snapshots").addEventListener("click", () => {
  openSnapshotManager({
    projectId,
    snapshots: state.snapshots,
    onChanged: loadAndRender,
  });
});

document.getElementById("zoom-select").addEventListener("change", (e) => {
  state.zoomLevel = e.target.value;
  render();
});

document.getElementById("toggle-inazuma").addEventListener("change", (e) => {
  state.showInazuma = e.target.checked;
  render();
});

document.getElementById("snapshot-count").addEventListener("change", (e) => {
  const v = Number(e.target.value);
  if (v > 0) {
    state.snapshotCount = v;
    render();
  }
});

// 担当者フィルタ
document.getElementById("assignee-filter").addEventListener("change", (e) => {
  const v = e.target.value;
  if (v === "all") state.assigneeFilter = null;
  else if (v === "unassigned") state.assigneeFilter = 0;
  else state.assigneeFilter = Number(v);
  render();
});

// 全展開・全折りたたみ
document.getElementById("btn-expand-all").addEventListener("click", () => {
  state.collapsedTaskIds.clear();
  saveCollapsedToStorage(state.collapsedTaskIds);
  render();
});

document.getElementById("btn-collapse-all").addEventListener("click", () => {
  // 子を持つ全タスクIDを収集
  const collectParents = (nodes) => {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) {
        state.collapsedTaskIds.add(n.id);
        collectParents(n.children);
      }
    }
  };
  collectParents(state.taskTree);
  saveCollapsedToStorage(state.collapsedTaskIds);
  render();
});

// 初回ロード（完了後、URLパラメータがあればタスクモーダルを開く）
loadAndRender().then(() => {
  const openTaskId = util.queryParam("openTask");
  if (openTaskId) {
    const task = state.tasks.find(t => t.id === Number(openTaskId));
    if (task) {
      openTaskEditor(task);
      // URLからパラメータを除去（再読み込みで再びモーダルが開かないように）
      const newUrl = location.pathname;
      history.replaceState({}, "", newUrl);
    }
  }
});
