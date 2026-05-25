// ToDoリスト画面

const listEl = document.getElementById("todo-list");
const filterSel = document.getElementById("assignee-filter");

let state = {
  todos: [],
  members: [],
  assigneeFilter: "all",  // "all" / "unassigned" / member_id (string)
};

async function loadData() {
  // メンバーをロードしてフィルタを構築
  state.members = await api.get("/members");
  renderFilter();

  // ToDoタスクをロード
  await loadTodos();
}

function renderFilter() {
  // 既存のoptionsを保持しつつ、メンバーを追加
  const currentValue = filterSel.value;
  filterSel.innerHTML = `
    <option value="all">全担当者</option>
    <option value="unassigned">未割当</option>
    ${state.members.map(m => `<option value="${m.id}">${util.escapeHtml(m.name)}</option>`).join("")}
  `;
  filterSel.value = currentValue || "all";
}

async function loadTodos() {
  try {
    let url = "/tasks/todo";
    const params = [];
    if (state.assigneeFilter === "unassigned") params.push("assignee_id=0");
    else if (state.assigneeFilter !== "all") params.push(`assignee_id=${state.assigneeFilter}`);
    if (params.length > 0) url += "?" + params.join("&");

    state.todos = await api.get(url);
    renderTodos();
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">読み込みエラー: ${util.escapeHtml(e.message)}</div>`;
  }
}

function renderTodos() {
  if (state.todos.length === 0) {
    listEl.innerHTML = `<div class="empty-state">該当するToDoはありません 🎉</div>`;
    return;
  }

  const memberMap = {};
  state.members.forEach(m => { memberMap[m.id] = m; });

  // プロジェクトごとにグループ化
  const grouped = {};
  for (const t of state.todos) {
    if (!grouped[t.project_id]) grouped[t.project_id] = { name: t.project_name, items: [] };
    grouped[t.project_id].items.push(t);
  }

  const html = Object.entries(grouped).map(([pid, group]) => `
    <div class="todo-group">
      <h3 class="todo-group__title">
        <a href="/projects/${pid}">${util.escapeHtml(group.name)}</a>
        <span class="todo-group__count">${group.items.length}件</span>
      </h3>
      <div class="todo-items">
        ${group.items.map(t => renderTodoItem(t, memberMap)).join("")}
      </div>
    </div>
  `).join("");

  listEl.innerHTML = html;
}

function renderTodoItem(task, memberMap) {
  const assignee = task.assignee_id && memberMap[task.assignee_id] ? memberMap[task.assignee_id] : null;
  const assigneeHtml = assignee
    ? `<span class="todo-item__assignee"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${assignee.color};margin-right:4px;vertical-align:middle"></span>${util.escapeHtml(assignee.name)}</span>`
    : `<span class="todo-item__assignee todo-item__assignee--none">未割当</span>`;

  const daysRemaining = task.days_remaining;
  let dueClass = "todo-item__due";
  let dueText = "";
  if (daysRemaining < 0) {
    dueClass += " todo-item__due--overdue";
    dueText = `${-daysRemaining}日超過`;
  } else if (daysRemaining === 0) {
    dueClass += " todo-item__due--today";
    dueText = "本日期限";
  } else if (daysRemaining <= 3) {
    dueClass += " todo-item__due--soon";
    dueText = `残り${daysRemaining}日`;
  } else {
    dueText = `残り${daysRemaining}日`;
  }

  const milestoneMark = task.is_milestone ? '<span style="color:var(--color-milestone);">◆ </span>' : '';

  return `
    <a class="todo-item" href="/projects/${task.project_id}?openTask=${task.id}">
      <div class="todo-item__name">${milestoneMark}${util.escapeHtml(task.name)}</div>
      <div class="todo-item__meta">
        ${assigneeHtml}
        <span class="todo-item__progress">進捗 ${task.progress}%</span>
        <span class="todo-item__dates">${task.start_date} → ${task.end_date}</span>
        <span class="${dueClass}">${dueText}</span>
      </div>
    </a>
  `;
}

filterSel.addEventListener("change", (e) => {
  state.assigneeFilter = e.target.value;
  loadTodos();
});

loadData();
