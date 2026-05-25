// スナップショット管理モーダル

/**
 * @param {Object} options
 *   - projectId: プロジェクトID
 *   - snapshots: 現在のスナップショット配列（新しい順）
 *   - onChanged: 変更後コールバック
 */
function openSnapshotManager(options) {
  const { projectId, snapshots, onChanged } = options;
  const mount = document.getElementById("modal-mount");

  const today = util.formatDate(util.today());

  mount.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal__header">
          <h3>スナップショット管理</h3>
          <button class="modal__close" id="modal-close">×</button>
        </div>

        <div class="form-row">
          <label>新規スナップショット作成（日付指定）</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="date" id="snap-date" value="${today}">
            <button class="btn btn--primary btn--sm" id="btn-create">作成</button>
          </div>
          <small style="color:var(--color-text-muted); font-size:11px;">
            同日のスナップショットがあれば上書きされます
          </small>
        </div>

        <h3 style="margin-top:20px;">記録済み (${snapshots.length}件)</h3>
        <div class="snap-list">
          ${snapshots.length === 0
            ? `<div class="empty-state" style="padding:16px;">まだスナップショットがありません</div>`
            : snapshots.map(s => `
                <div class="snap-row" data-id="${s.id}">
                  <div class="snap-row__date">${s.snapshot_date}</div>
                  <div class="snap-row__meta">${s.task_progresses.length} task(s)</div>
                  <button class="btn btn--sm btn--danger" data-delete="${s.id}">削除</button>
                </div>
              `).join("")
          }
        </div>

        <div class="modal__footer">
          <button type="button" class="btn" id="modal-cancel">閉じる</button>
        </div>
      </div>
    </div>
  `;

  const close = () => { mount.innerHTML = ""; };
  document.getElementById("modal-close").addEventListener("click", close);
  document.getElementById("modal-cancel").addEventListener("click", close);

  document.getElementById("btn-create").addEventListener("click", async () => {
    const date = document.getElementById("snap-date").value;
    if (!date) {
      util.toast("日付を選んでください");
      return;
    }
    try {
      await api.post(`/projects/${projectId}/snapshots`, { snapshot_date: date });
      util.toast("作成しました");
      close();
      if (onChanged) onChanged();
    } catch (e) {
      util.toast("作成エラー: " + e.message);
    }
  });

  mount.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.delete);
      const snap = snapshots.find(s => s.id === id);
      if (!util.confirm(`${snap.snapshot_date} のスナップショットを削除しますか？`)) return;
      try {
        await api.del(`/projects/${projectId}/snapshots/${id}`);
        util.toast("削除しました");
        close();
        if (onChanged) onChanged();
      } catch (e) {
        util.toast("削除エラー: " + e.message);
      }
    });
  });
}

window.openSnapshotManager = openSnapshotManager;
