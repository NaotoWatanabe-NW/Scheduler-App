// プロジェクト一覧画面

const listEl = document.getElementById("project-list");
const modalMount = document.getElementById("modal-mount");

// 表示状態：完了済みを含めるかどうか
let includeCompleted = false;

async function loadProjects() {
  try {
    const params = includeCompleted ? "?include_completed=true" : "";
    const projects = await api.get("/projects" + params);
    renderProjects(projects);
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">読み込みエラー: ${util.escapeHtml(e.message)}</div>`;
  }
}

function renderProjects(projects) {
  if (projects.length === 0) {
    const msg = includeCompleted
      ? "プロジェクトがありません。「+ 新規プロジェクト」から作成してください。"
      : "未完了のプロジェクトがありません。「完了済みも表示」で過去のプロジェクトを確認できます。";
    listEl.innerHTML = `<div class="empty-state">${msg}</div>`;
    return;
  }

  const html = `<div class="project-grid">${projects.map(p => {
    const completedBadge = p.is_completed
      ? `<span class="project-card__badge project-card__badge--completed">完了</span>`
      : "";
    const completeBtn = p.is_completed
      ? `<button class="btn btn--sm" data-reopen="${p.id}">再開</button>`
      : `<button class="btn btn--sm" data-complete="${p.id}">完了にする</button>`;

    return `
      <div class="project-card ${p.is_completed ? 'project-card--completed' : ''}">
        <div class="project-card__title">
          ${util.escapeHtml(p.name)}
          ${completedBadge}
        </div>
        <div class="project-card__meta">
          ${p.effective_start_date || "未設定"} 〜 ${p.effective_end_date || "未設定"}
          ${(!p.start_date || !p.end_date) && (p.effective_start_date || p.effective_end_date) ? '<span style="font-size:10px;color:var(--color-text-muted);"> (自動算出)</span>' : ''}
        </div>
        ${p.description ? `<div class="project-card__meta">${util.escapeHtml(p.description)}</div>` : ""}
        <div class="project-card__actions">
          <a class="btn btn--primary btn--sm" href="/projects/${p.id}">開く</a>
          <button class="btn btn--sm" data-edit="${p.id}">編集</button>
          ${completeBtn}
          <button class="btn btn--sm btn--danger" data-delete="${p.id}">削除</button>
        </div>
      </div>
    `;
  }).join("")}</div>`;

  listEl.innerHTML = html;

  // 編集
  listEl.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.edit);
      openProjectModal(projects.find(p => p.id === id));
    });
  });

  // 削除
  listEl.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.delete);
      const project = projects.find(p => p.id === id);
      if (!util.confirm(`プロジェクト「${project.name}」を削除しますか？\nタスクとスナップショットもすべて削除されます。`)) return;
      try {
        await api.del(`/projects/${id}`);
        util.toast("削除しました");
        loadProjects();
      } catch (e) {
        util.toast("削除エラー: " + e.message);
      }
    });
  });

  // 完了マーク
  listEl.querySelectorAll("[data-complete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.complete);
      const project = projects.find(p => p.id === id);
      await updateCompletion(project, true);
    });
  });

  // 再開（完了解除）
  listEl.querySelectorAll("[data-reopen]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.reopen);
      const project = projects.find(p => p.id === id);
      await updateCompletion(project, false);
    });
  });
}

async function updateCompletion(project, isCompleted) {
  // PUTは全フィールド送る形にしているのでそのまま渡す
  const payload = {
    name: project.name,
    description: project.description,
    start_date: project.start_date,
    end_date: project.end_date,
    is_completed: isCompleted,
  };
  try {
    await api.put(`/projects/${project.id}`, payload);
    util.toast(isCompleted ? "完了にしました" : "再開しました");
    loadProjects();
  } catch (e) {
    util.toast("更新エラー: " + e.message);
  }
}

function openProjectModal(project = null) {
  const isEdit = project !== null;
  modalMount.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3>${isEdit ? "プロジェクト編集" : "新規プロジェクト"}</h3>
          <button class="modal__close" id="modal-close">×</button>
        </div>
        <form id="project-form">
          <div class="form-row">
            <label>名前 *</label>
            <input type="text" name="name" required maxlength="200"
                   value="${isEdit ? util.escapeHtml(project.name) : ""}">
          </div>
          <div class="form-row">
            <label>説明</label>
            <textarea name="description">${isEdit && project.description ? util.escapeHtml(project.description) : ""}</textarea>
          </div>
          ${isEdit ? `
            <div style="border:1px solid var(--color-border); border-radius:6px; padding:10px 12px; margin-bottom:12px; background:#faf9f4;">
              <div style="font-size:11px; color:var(--color-text-muted); margin-bottom:8px;">
                通常は未設定でOK（タスクから自動算出されます）。手動で固定したい場合のみ入力。
              </div>
              <div class="form-row__pair" style="margin:0;">
                <div class="form-row" style="margin:0;">
                  <label>開始日（手動オーバーライド）</label>
                  <input type="date" name="start_date"
                         value="${project.start_date ? project.start_date : ""}">
                </div>
                <div class="form-row" style="margin:0;">
                  <label>終了日（手動オーバーライド）</label>
                  <input type="date" name="end_date"
                         value="${project.end_date ? project.end_date : ""}">
                </div>
              </div>
            </div>
            <div class="form-row form-row__inline">
              <input type="checkbox" id="is-completed" name="is_completed" ${project.is_completed ? "checked" : ""}>
              <label for="is-completed">完了済みにする</label>
            </div>
          ` : `
            <div style="font-size:12px; color:var(--color-text-muted); padding:8px 12px; background:#faf9f4; border-radius:6px; margin-bottom:12px;">
              💡 開始日・終了日はタスクから自動算出されます。手動設定したい場合は作成後に「編集」から入力してください。
            </div>
          `}
          <div class="modal__footer">
            <button type="button" class="btn" id="modal-cancel">キャンセル</button>
            <button type="submit" class="btn btn--primary">${isEdit ? "更新" : "作成"}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const close = () => { modalMount.innerHTML = ""; };
  document.getElementById("modal-close").addEventListener("click", close);
  document.getElementById("modal-cancel").addEventListener("click", close);

  document.getElementById("project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get("name").trim(),
      description: fd.get("description").trim() || null,
      // 編集時のみ日付フィールドが存在する
      start_date: isEdit ? (fd.get("start_date") || null) : null,
      end_date: isEdit ? (fd.get("end_date") || null) : null,
      is_completed: isEdit ? fd.get("is_completed") === "on" : false,
    };
    try {
      if (isEdit) {
        await api.put(`/projects/${project.id}`, payload);
        util.toast("更新しました");
      } else {
        await api.post("/projects", payload);
        util.toast("作成しました");
      }
      close();
      loadProjects();
    } catch (err) {
      util.toast("エラー: " + err.message);
    }
  });
}

document.getElementById("btn-new-project").addEventListener("click", () => openProjectModal());

// 完了済みも表示するトグル
document.getElementById("toggle-completed").addEventListener("change", (e) => {
  includeCompleted = e.target.checked;
  loadProjects();
});

loadProjects();
