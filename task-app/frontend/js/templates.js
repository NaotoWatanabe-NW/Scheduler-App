// タスクテンプレート管理画面
//
// テンプレート = タスク一式（2階層: タスク＋子タスク）＋説明＋必要日数＋先行タスク。
// プロジェクト画面から開始日（または終了日で逆算）を指定して適用すると日付が自動計算され、
// 先行タスクはタスクの依存関係としてコピーされる（フロー図に反映）。

const listEl = document.getElementById("template-list");

let templates = [];

// ===== 一覧 =====

async function loadAndRender() {
  try {
    templates = await api.get("/templates");
    renderList();
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">読み込みエラー: ${util.escapeHtml(e.message)}</div>`;
  }
}

// 末端アイテム（実際にバーになるタスク）の数と合計日数
function summarize(items) {
  let count = 0;
  let days = 0;
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) walk(n.children);
      else { count++; days += n.duration_days; }
    }
  };
  walk(items);
  return { count, days };
}

function renderList() {
  if (templates.length === 0) {
    listEl.innerHTML = `<div class="empty-state">テンプレートがありません。「+ 新規テンプレート」から作成してください。</div>`;
    return;
  }

  listEl.innerHTML = templates.map(t => {
    const { count, days } = summarize(t.items);
    const depCount = (t.dependencies || []).length;
    const itemsPreview = t.items.map(it => {
      const childNames = (it.children || []).map(c => util.escapeHtml(c.name)).join("、");
      return `<li>${util.escapeHtml(it.name)}${childNames ? `<span class="tpl-card__children">（${childNames}）</span>` : ""}</li>`;
    }).join("");
    return `
      <div class="card tpl-card">
        <div class="tpl-card__header">
          <div>
            <h3 class="tpl-card__name">${util.escapeHtml(t.name)}</h3>
            ${t.description ? `<div class="tpl-card__desc">${util.escapeHtml(t.description)}</div>` : ""}
          </div>
          <div class="tpl-card__actions">
            <span class="tpl-card__summary">タスク${count}件 / 計${days}営業日${depCount ? ` / 依存${depCount}件` : ""}</span>
            <button class="btn btn--sm" data-edit="${t.id}">編集</button>
            <button class="btn btn--sm btn--danger" data-delete="${t.id}">削除</button>
          </div>
        </div>
        <ul class="tpl-card__items">${itemsPreview}</ul>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = templates.find(x => x.id === Number(btn.dataset.edit));
      if (t) openTemplateModal(t);
    });
  });
  listEl.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const t = templates.find(x => x.id === Number(btn.dataset.delete));
      if (!t) return;
      if (!util.confirm(`テンプレート「${t.name}」を削除しますか？`)) return;
      try {
        await api.del(`/templates/${t.id}`);
        util.toast("削除しました");
        loadAndRender();
      } catch (e) {
        util.toast("削除エラー: " + e.message);
      }
    });
  });
}

// ===== 編集モーダル =====

function openTemplateModal(template) {
  const isEdit = template !== null;
  const mount = document.getElementById("modal-mount");
  let keyCounter = 0;
  const newKey = () => `n${keyCounter++}`;

  mount.innerHTML = `
    <div class="modal-overlay">
      <div class="modal modal--wide">
        <div class="modal__header">
          <h3>${isEdit ? "テンプレート編集" : "新規テンプレート"}</h3>
          <button class="modal__close" id="modal-close">×</button>
        </div>
        <form id="tpl-form">
          <div class="form-row">
            <label>テンプレート名 *</label>
            <input type="text" id="tpl-name" required maxlength="200"
                   value="${isEdit ? util.escapeHtml(template.name) : ""}">
          </div>
          <div class="form-row">
            <label>説明</label>
            <input type="text" id="tpl-description"
                   value="${isEdit && template.description ? util.escapeHtml(template.description) : ""}">
          </div>
          <div class="form-row">
            <label>タスク（日数は営業日。「先行」を指定すると依存関係になり、指定がなければ上から直列に配置）</label>
            <div id="tpl-items"></div>
            <button type="button" class="btn btn--sm" id="tpl-add-item" style="margin-top:6px;">＋ タスク追加</button>
          </div>
          <div class="modal__footer">
            <button type="button" class="btn" id="modal-cancel">キャンセル</button>
            <button type="submit" class="btn btn--primary">${isEdit ? "更新" : "作成"}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const itemsEl = document.getElementById("tpl-items");

  // 依存関係（key ペア）はモーダル内の状態として保持
  let deps = [];

  // 初期アイテム: 既存テンプレートのアイテムに key を割り当てる（"i{id}"）
  const assignKeys = (nodes) => nodes.map(n => ({
    key: `i${n.id}`,
    name: n.name,
    description: n.description,
    duration_days: n.duration_days,
    children: assignKeys(n.children || []),
  }));

  const initialItems = isEdit && template.items.length > 0
    ? assignKeys(template.items)
    : [{ key: newKey(), name: "", duration_days: 1, description: null, children: [] }];

  if (isEdit) {
    deps = (template.dependencies || []).map(d => ({
      predecessor_key: `i${d.predecessor_id}`,
      successor_key: `i${d.successor_id}`,
    }));
  }

  // 現在のDOMからアイテム定義を読み取る（再描画時の入力保持用）
  const collectItems = () => {
    const readRow = (el) => ({
      key: el.dataset.key,
      name: el.querySelector(":scope > .tpl-row .tpl-input-name").value,
      duration_days: Number(el.querySelector(":scope > .tpl-row .tpl-input-days").value) || 1,
      description: el.querySelector(":scope > .tpl-row .tpl-input-desc").value || null,
    });
    return Array.from(itemsEl.querySelectorAll(".tpl-item")).map(itemEl => ({
      ...readRow(itemEl),
      children: Array.from(itemEl.querySelectorAll(".tpl-child")).map(childEl => ({
        ...readRow(childEl),
        children: [],
      })),
    }));
  };

  // 全アイテムを平坦化（key→名前の解決用）
  const flatten = (items) => {
    const out = [];
    for (const it of items) {
      out.push(it);
      out.push(...(it.children || []));
    }
    return out;
  };

  // 存在しない key を参照する依存を除去
  const pruneDeps = (items) => {
    const keys = new Set(flatten(items).map(it => it.key));
    deps = deps.filter(d => keys.has(d.predecessor_key) && keys.has(d.successor_key));
  };

  const rowHtml = (item, isParentWithChildren) => `
    <div class="tpl-row">
      <input type="text" class="tpl-input-name" placeholder="タスク名" maxlength="200"
             value="${util.escapeHtml(item.name || "")}">
      <input type="number" class="tpl-input-days" min="1" title="必要日数（営業日）"
             value="${item.duration_days || 1}" ${isParentWithChildren ? "disabled" : ""}>
      <span class="tpl-days-unit">日</span>
      <input type="text" class="tpl-input-desc" placeholder="説明（任意）"
             value="${util.escapeHtml(item.description || "")}">
    </div>
  `;

  // アイテムの「先行」チップ＋追加セレクト
  const depsHtml = (item, allItems) => {
    const preds = deps.filter(d => d.successor_key === item.key);
    const nameOf = (key) => {
      const target = allItems.find(it => it.key === key);
      return target ? (target.name || "（無名）") : key;
    };
    const predKeys = new Set(preds.map(d => d.predecessor_key));
    const candidates = allItems.filter(it => it.key !== item.key && !predKeys.has(it.key));
    return `
      <div class="tpl-deps">
        <span class="tpl-deps__label">先行:</span>
        ${preds.map(d => `
          <span class="tpl-dep-chip">${util.escapeHtml(nameOf(d.predecessor_key))}
            <button type="button" class="tpl-dep-remove" data-pred="${d.predecessor_key}" data-succ="${item.key}">×</button>
          </span>`).join("")}
        ${preds.length === 0 ? `<span class="tpl-deps__none">なし</span>` : ""}
        <select class="tpl-dep-select" data-succ="${item.key}">
          <option value="">＋ 先行を追加</option>
          ${candidates.map(c => `<option value="${c.key}">${util.escapeHtml(c.name || "（無名）")}</option>`).join("")}
        </select>
      </div>
    `;
  };

  const renderItems = (items) => {
    pruneDeps(items);
    const allItems = flatten(items);

    itemsEl.innerHTML = items.map((item) => {
      const hasChildren = item.children && item.children.length > 0;
      return `
        <div class="tpl-item" data-key="${item.key}">
          ${rowHtml(item, hasChildren)}
          <div class="tpl-item__note">${hasChildren ? "期間は子タスクから自動計算されます" : ""}</div>
          ${depsHtml(item, allItems)}
          <div class="tpl-children">
            ${(item.children || []).map((c) => `
              <div class="tpl-child" data-key="${c.key}">
                ${rowHtml(c, false)}
                ${depsHtml(c, allItems)}
                <button type="button" class="btn btn--sm tpl-remove-child" data-key="${c.key}">×</button>
              </div>
            `).join("")}
          </div>
          <div class="tpl-item__actions">
            <button type="button" class="btn btn--sm tpl-add-child" data-key="${item.key}">＋ 子タスク</button>
            <button type="button" class="btn btn--sm btn--danger tpl-remove-item" data-key="${item.key}">タスク削除</button>
          </div>
        </div>
      `;
    }).join("");

    // 構造変更系のハンドラ（入力値はcollectItemsで保持して再描画）
    itemsEl.querySelectorAll(".tpl-add-child").forEach(btn => {
      btn.addEventListener("click", () => {
        const items = collectItems();
        const target = items.find(it => it.key === btn.dataset.key);
        if (target) target.children.push({ key: newKey(), name: "", duration_days: 1, description: null, children: [] });
        renderItems(items);
      });
    });
    itemsEl.querySelectorAll(".tpl-remove-child").forEach(btn => {
      btn.addEventListener("click", () => {
        const items = collectItems();
        for (const it of items) {
          it.children = it.children.filter(c => c.key !== btn.dataset.key);
        }
        renderItems(items);
      });
    });
    itemsEl.querySelectorAll(".tpl-remove-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const items = collectItems().filter(it => it.key !== btn.dataset.key);
        renderItems(items);
      });
    });
    // 依存の追加・削除
    itemsEl.querySelectorAll(".tpl-dep-select").forEach(sel => {
      sel.addEventListener("change", () => {
        if (!sel.value) return;
        deps.push({ predecessor_key: sel.value, successor_key: sel.dataset.succ });
        renderItems(collectItems());
      });
    });
    itemsEl.querySelectorAll(".tpl-dep-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        deps = deps.filter(d =>
          !(d.predecessor_key === btn.dataset.pred && d.successor_key === btn.dataset.succ));
        renderItems(collectItems());
      });
    });
  };

  renderItems(initialItems);

  document.getElementById("tpl-add-item").addEventListener("click", () => {
    const items = collectItems();
    items.push({ key: newKey(), name: "", duration_days: 1, description: null, children: [] });
    renderItems(items);
  });

  const close = () => { mount.innerHTML = ""; };
  document.getElementById("modal-close").addEventListener("click", close);
  document.getElementById("modal-cancel").addEventListener("click", close);

  document.getElementById("tpl-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const items = collectItems();

    // バリデーション: 空行を除去し、名前必須チェック
    const cleaned = items
      .map(it => ({
        ...it,
        name: it.name.trim(),
        children: it.children
          .map(c => ({ ...c, name: c.name.trim() }))
          .filter(c => c.name !== ""),
      }))
      .filter(it => it.name !== "" || it.children.length > 0);

    if (cleaned.some(it => it.name === "")) {
      util.toast("子タスクを持つタスクにも名前を付けてください");
      return;
    }
    if (cleaned.length === 0) {
      util.toast("タスクを1件以上登録してください");
      return;
    }

    // 除去された行への依存を落とす
    const validKeys = new Set(flatten(cleaned).map(it => it.key));
    const cleanedDeps = deps.filter(d =>
      validKeys.has(d.predecessor_key) && validKeys.has(d.successor_key));

    const payload = {
      name: document.getElementById("tpl-name").value.trim(),
      description: document.getElementById("tpl-description").value.trim() || null,
      items: cleaned,
      dependencies: cleanedDeps,
    };

    try {
      if (isEdit) {
        await api.put(`/templates/${template.id}`, payload);
        util.toast("更新しました");
      } else {
        await api.post("/templates", payload);
        util.toast("作成しました");
      }
      close();
      loadAndRender();
    } catch (err) {
      util.toast("エラー: " + err.message);
    }
  });
}

// ===== イベント =====

document.getElementById("btn-new-template").addEventListener("click", () => {
  openTemplateModal(null);
});

loadAndRender();
