// メンバー管理画面

const listEl = document.getElementById("member-list");
const modalMount = document.getElementById("modal-mount");

async function loadMembers() {
  try {
    const members = await api.get("/members");
    renderMembers(members);
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">読み込みエラー: ${util.escapeHtml(e.message)}</div>`;
  }
}

function renderMembers(members) {
  if (members.length === 0) {
    listEl.innerHTML = `<div class="empty-state">メンバーがいません。</div>`;
    return;
  }
  listEl.innerHTML = `<div class="member-list">${members.map(m => `
    <div class="member-row">
      <div class="member-row__color" style="background:${m.color}"></div>
      <div class="member-row__name">${util.escapeHtml(m.name)}</div>
      <button class="btn btn--sm" data-edit="${m.id}">編集</button>
      <button class="btn btn--sm btn--danger" data-delete="${m.id}">削除</button>
    </div>
  `).join("")}</div>`;

  listEl.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.edit);
      openMemberModal(members.find(m => m.id === id));
    });
  });
  listEl.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.delete);
      const m = members.find(m => m.id === id);
      if (!util.confirm(`メンバー「${m.name}」を削除しますか？\n（割り当て中のタスクは「未割当」になります）`)) return;
      try {
        await api.del(`/members/${id}`);
        util.toast("削除しました");
        loadMembers();
      } catch (e) {
        util.toast("削除エラー: " + e.message);
      }
    });
  });
}

function openMemberModal(member = null) {
  const isEdit = member !== null;
  modalMount.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3>${isEdit ? "メンバー編集" : "新規メンバー"}</h3>
          <button class="modal__close" id="modal-close">×</button>
        </div>
        <form id="member-form">
          <div class="form-row">
            <label>名前 *</label>
            <input type="text" name="name" required maxlength="100"
                   value="${isEdit ? util.escapeHtml(member.name) : ""}">
          </div>
          <div class="form-row">
            <label>識別色</label>
            <input type="color" name="color"
                   value="${isEdit ? member.color : "#3380C0"}">
          </div>
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
  document.getElementById("member-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = { name: fd.get("name").trim(), color: fd.get("color") };
    try {
      if (isEdit) await api.put(`/members/${member.id}`, payload);
      else await api.post("/members", payload);
      util.toast(isEdit ? "更新しました" : "作成しました");
      close();
      loadMembers();
    } catch (err) {
      util.toast("エラー: " + err.message);
    }
  });
}

document.getElementById("btn-new-member").addEventListener("click", () => openMemberModal());
loadMembers();
