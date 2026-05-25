// タスク編集モーダル

/**
 * タスク編集モーダルを開く
 *
 * @param {Object} options
 *   - projectId: プロジェクトID
 *   - task: 編集対象タスク（nullなら新規作成）
 *   - allTasks: 同プロジェクトの全タスク（親タスク選択用）
 *   - members: 全メンバー（担当者選択用）
 *   - onSaved: 保存後コールバック
 */
function openTaskModal(options) {
  const { projectId, task, allTasks, members, onSaved } = options;
  const isEdit = task !== null;
  const mount = document.getElementById("modal-mount");

  // 親タスク候補：自分自身と自分の子孫は除外
  const excluded = new Set();
  if (isEdit) {
    const collect = (id) => {
      excluded.add(id);
      allTasks.forEach(t => {
        if (t.parent_task_id === id) collect(t.id);
      });
    };
    collect(task.id);
  }
  const parentOptions = allTasks
    .filter(t => !excluded.has(t.id))
    .map(t => ({ id: t.id, name: t.name }));

  mount.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3>${isEdit ? "タスク編集" : "新規タスク"}</h3>
          <button class="modal__close" id="modal-close">×</button>
        </div>
        <form id="task-form">
          <div class="form-row">
            <label>タスク名 *</label>
            <input type="text" name="name" required maxlength="200"
                   value="${isEdit ? util.escapeHtml(task.name) : ""}">
          </div>
          <div class="form-row">
            <label>説明</label>
            <textarea name="description">${isEdit && task.description ? util.escapeHtml(task.description) : ""}</textarea>
          </div>
          <div class="form-row__pair">
            <div class="form-row">
              <label>開始日 *</label>
              <input type="date" name="start_date" required
                     value="${isEdit ? task.start_date : ""}">
            </div>
            <div class="form-row">
              <label>期日 *</label>
              <input type="date" name="end_date" required
                     value="${isEdit ? task.end_date : ""}">
            </div>
          </div>
          <div class="form-row__pair">
            <div class="form-row">
              <label>進捗 (%)</label>
              <input type="number" name="progress" min="0" max="100"
                     value="${isEdit ? task.progress : 0}">
            </div>
            <div class="form-row">
              <label>担当者</label>
              <select name="assignee_id">
                <option value="">未割当</option>
                ${members.map(m => `
                  <option value="${m.id}" ${isEdit && task.assignee_id === m.id ? "selected" : ""}>${util.escapeHtml(m.name)}</option>
                `).join("")}
              </select>
            </div>
          </div>
          <div class="form-row">
            <label>親タスク</label>
            <select name="parent_task_id">
              <option value="">（なし）</option>
              ${parentOptions.map(p => `
                <option value="${p.id}" ${isEdit && task.parent_task_id === p.id ? "selected" : ""}>${util.escapeHtml(p.name)}</option>
              `).join("")}
            </select>
          </div>
          <div class="form-row form-row__inline">
            <input type="checkbox" id="is-milestone" name="is_milestone"
                   ${isEdit && task.is_milestone ? "checked" : ""}>
            <label for="is-milestone">マイルストーン</label>
          </div>
          <div class="modal__footer">
            ${isEdit ? `<button type="button" class="btn btn--danger" id="btn-delete">削除</button>` : ""}
            ${isEdit ? `<button type="button" class="btn btn--secondary" id="btn-move">別プロジェクトへ移動</button>` : ""}
            <button type="button" class="btn" id="modal-cancel">キャンセル</button>
            <button type="submit" class="btn btn--primary">${isEdit ? "更新" : "作成"}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const close = () => { mount.innerHTML = ""; };
  document.getElementById("modal-close").addEventListener("click", close);
  document.getElementById("modal-cancel").addEventListener("click", close);

  if (isEdit) {
    document.getElementById("btn-delete").addEventListener("click", async () => {
      if (!util.confirm(`タスク「${task.name}」を削除しますか？\n（子タスクも一緒に削除されます）`)) return;
      try {
        await api.del(`/tasks/${task.id}`);
        util.toast("削除しました");
        close();
        if (onSaved) onSaved();
      } catch (e) {
        util.toast("削除エラー: " + e.message);
      }
    });

    document.getElementById("btn-move").addEventListener("click", async () => {
      await openMoveProjectDialog({ task, onMoved: () => { close(); if (onSaved) onSaved(); } });
    });
  }

  document.getElementById("task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get("name").trim(),
      description: fd.get("description").trim() || null,
      start_date: fd.get("start_date"),
      end_date: fd.get("end_date"),
      progress: Number(fd.get("progress")) || 0,
      assignee_id: fd.get("assignee_id") ? Number(fd.get("assignee_id")) : null,
      parent_task_id: fd.get("parent_task_id") ? Number(fd.get("parent_task_id")) : null,
      is_milestone: fd.get("is_milestone") === "on",
    };

    // クライアント側の簡易バリデーション
    if (payload.start_date > payload.end_date) {
      util.toast("開始日は期日以前である必要があります");
      return;
    }

    try {
      if (isEdit) {
        await api.put(`/tasks/${task.id}`, payload);
        util.toast("更新しました");
      } else {
        await api.post(`/projects/${projectId}/tasks`, payload);
        util.toast("作成しました");
      }
      close();
      if (onSaved) onSaved();
    } catch (err) {
      util.toast("エラー: " + err.message);
    }
  });
}

/**
 * プロジェクト選択ダイアログを開き、移動先を確定したらAPIを呼ぶ
 */
async function openMoveProjectDialog({ task, onMoved }) {
  const mount = document.getElementById("modal-mount");

  let projects;
  try {
    projects = await api.get("/projects");
  } catch (e) {
    util.toast("プロジェクト一覧の取得に失敗しました: " + e.message);
    return;
  }

  const candidates = projects.filter(p => p.id !== task.project_id);
  if (candidates.length === 0) {
    util.toast("移動先となるプロジェクトがありません");
    return;
  }

  mount.innerHTML = `
    <div class="modal-overlay">
      <div class="modal modal--narrow">
        <div class="modal__header">
          <h3>移動先プロジェクトを選択</h3>
          <button class="modal__close" id="move-close">×</button>
        </div>
        <div class="move-dialog__body">
          <p class="move-dialog__task-name">「${util.escapeHtml(task.name)}」を移動します。<br>子タスクもすべて一緒に移動されます。</p>
          <ul class="move-dialog__list" id="move-project-list">
            ${candidates.map(p => `
              <li>
                <button class="move-dialog__item" data-project-id="${p.id}">
                  ${util.escapeHtml(p.name)}
                </button>
              </li>
            `).join("")}
          </ul>
        </div>
        <div class="modal__footer">
          <button type="button" class="btn" id="move-cancel">キャンセル</button>
        </div>
      </div>
    </div>
  `;

  const closeDialog = () => { mount.innerHTML = ""; };
  document.getElementById("move-close").addEventListener("click", closeDialog);
  document.getElementById("move-cancel").addEventListener("click", closeDialog);

  document.getElementById("move-project-list").addEventListener("click", async (e) => {
    const btn = e.target.closest(".move-dialog__item");
    if (!btn) return;
    const targetProjectId = Number(btn.dataset.projectId);
    const targetName = btn.textContent.trim();
    if (!util.confirm(`タスク「${task.name}」を「${targetName}」に移動しますか？\n（子タスクも一緒に移動されます）`)) return;
    try {
      await api.post(`/tasks/${task.id}/move`, { target_project_id: targetProjectId });
      util.toast(`「${targetName}」に移動しました`);
      closeDialog();
      if (onMoved) onMoved();
    } catch (err) {
      util.toast("移動エラー: " + err.message);
    }
  });
}

window.openTaskModal = openTaskModal;
