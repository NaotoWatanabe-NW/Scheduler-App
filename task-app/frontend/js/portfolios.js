// 統合プロジェクト一覧・編集画面
//
// 統合プロジェクト = 複数プロジェクトをまとめた閲覧専用ビューの定義。
// ここでは定義のCRUDのみを行い、表示は /portfolios/{id} で行う。

const listEl = document.getElementById("portfolio-list");

let portfolios = [];
let allProjects = [];  // 選択肢用（完了済み含む）

async function loadAndRender() {
  try {
    [portfolios, allProjects] = await Promise.all([
      api.get("/portfolios"),
      api.get("/projects?include_completed=true"),
    ]);
    renderList();
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">読み込みエラー: ${util.escapeHtml(e.message)}</div>`;
  }
}

function projectName(id) {
  const p = allProjects.find(x => x.id === id);
  return p ? p.name : `プロジェクト#${id}`;
}

function renderList() {
  if (portfolios.length === 0) {
    listEl.innerHTML = `<div class="empty-state">統合プロジェクトがありません。「+ 新規統合プロジェクト」から作成してください。</div>`;
    return;
  }

  listEl.innerHTML = portfolios.map(pf => `
    <div class="card tpl-card">
      <div class="tpl-card__header">
        <div>
          <h3 class="tpl-card__name"><a href="/portfolios/${pf.id}">${util.escapeHtml(pf.name)}</a></h3>
          ${pf.description ? `<div class="tpl-card__desc">${util.escapeHtml(pf.description)}</div>` : ""}
        </div>
        <div class="tpl-card__actions">
          <span class="tpl-card__summary">${pf.project_ids.length}プロジェクト</span>
          <a class="btn btn--sm btn--primary" href="/portfolios/${pf.id}">表示</a>
          <button class="btn btn--sm" data-edit="${pf.id}">編集</button>
          <button class="btn btn--sm btn--danger" data-delete="${pf.id}">削除</button>
        </div>
      </div>
      <ul class="tpl-card__items">
        ${pf.project_ids.map(pid => `<li>${util.escapeHtml(projectName(pid))}</li>`).join("")}
      </ul>
    </div>
  `).join("");

  listEl.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const pf = portfolios.find(x => x.id === Number(btn.dataset.edit));
      if (pf) openPortfolioModal(pf);
    });
  });
  listEl.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const pf = portfolios.find(x => x.id === Number(btn.dataset.delete));
      if (!pf) return;
      if (!util.confirm(`統合プロジェクト「${pf.name}」を削除しますか？\n（各プロジェクト自体は削除されません）`)) return;
      try {
        await api.del(`/portfolios/${pf.id}`);
        util.toast("削除しました");
        loadAndRender();
      } catch (e) {
        util.toast("削除エラー: " + e.message);
      }
    });
  });
}

function openPortfolioModal(portfolio) {
  const isEdit = portfolio !== null;
  const mount = document.getElementById("modal-mount");
  const selected = new Set(isEdit ? portfolio.project_ids : []);

  mount.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3>${isEdit ? "統合プロジェクト編集" : "新規統合プロジェクト"}</h3>
          <button class="modal__close" id="modal-close">×</button>
        </div>
        <form id="pf-form">
          <div class="form-row">
            <label>名前 *</label>
            <input type="text" name="name" required maxlength="200"
                   value="${isEdit ? util.escapeHtml(portfolio.name) : ""}">
          </div>
          <div class="form-row">
            <label>説明</label>
            <input type="text" name="description"
                   value="${isEdit && portfolio.description ? util.escapeHtml(portfolio.description) : ""}">
          </div>
          <div class="form-row">
            <label>表示するプロジェクト *</label>
            <div class="pf-project-list">
              ${allProjects.map(p => `
                <label class="pf-project-item">
                  <input type="checkbox" value="${p.id}" ${selected.has(p.id) ? "checked" : ""}>
                  <span>${util.escapeHtml(p.name)}</span>
                  ${p.is_completed ? '<span class="project-card__badge project-card__badge--completed">完了</span>' : ""}
                </label>
              `).join("")}
            </div>
          </div>
          <div class="modal__footer">
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

  document.getElementById("pf-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const projectIds = Array.from(
      mount.querySelectorAll(".pf-project-list input:checked")
    ).map(cb => Number(cb.value));

    if (projectIds.length === 0) {
      util.toast("プロジェクトを1つ以上選択してください");
      return;
    }

    const payload = {
      name: fd.get("name").trim(),
      description: fd.get("description").trim() || null,
      project_ids: projectIds,
    };

    try {
      if (isEdit) {
        await api.put(`/portfolios/${portfolio.id}`, payload);
        util.toast("更新しました");
      } else {
        await api.post("/portfolios", payload);
        util.toast("作成しました");
      }
      close();
      loadAndRender();
    } catch (err) {
      util.toast("エラー: " + err.message);
    }
  });
}

document.getElementById("btn-new-portfolio").addEventListener("click", () => {
  if (allProjects.length === 0) {
    util.toast("まとめる対象のプロジェクトがありません");
    return;
  }
  openPortfolioModal(null);
});

loadAndRender();
