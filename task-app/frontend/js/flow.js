// フローチャート画面
//
// タスクの依存関係（先行→後続）をDAGとして左→右にレイアウトして描画する。
// - 列（レイヤー）= 依存の深さ（最長パス）
// - 依存に関わらないタスクは下部の「依存関係のないタスク」に一覧表示
// - ノードクリックでガント画面のタスク編集モーダルへ

const SVG_NS = "http://www.w3.org/2000/svg";
const projectId = util.pathId("/projects");

const NODE = { W: 190, H: 62, HGAP: 70, VGAP: 20, PAD: 30 };

function svgEl(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else if (c) el.appendChild(c);
  }
  return el;
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

// テキストを指定文字数で省略
function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function load() {
  const [project, taskTree, deps, members] = await Promise.all([
    api.get(`/projects/${projectId}`),
    api.get(`/projects/${projectId}/tasks`),
    api.get(`/projects/${projectId}/dependencies`),
    api.get("/members"),
  ]);

  document.getElementById("project-title").textContent = `${project.name} - フロー図`;
  document.getElementById("link-back").href = `/projects/${projectId}`;
  document.title = `Task App - フロー図 - ${project.name}`;

  const allTasks = flattenTree(taskTree);
  render(allTasks, deps, members);
}

function render(allTasks, deps, members) {
  const container = document.getElementById("flow-chart");
  const isolatedEl = document.getElementById("flow-isolated");
  container.innerHTML = "";
  isolatedEl.innerHTML = "";

  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m; });

  // 依存に関わるタスクIDの集合
  const connectedIds = new Set();
  deps.forEach(d => { connectedIds.add(d.predecessor_id); connectedIds.add(d.successor_id); });

  const taskMap = {};
  allTasks.forEach(t => { taskMap[t.id] = t; });

  // フローに載せるノード: 依存に関わるタスク
  const nodes = allTasks.filter(t => connectedIds.has(t.id));
  // 依存に関わらない末端タスク（親タスク=グループ見出しは除く）
  const isolated = allTasks.filter(
    t => !connectedIds.has(t.id) && !(t.children && t.children.length > 0)
  );

  if (nodes.length === 0) {
    container.innerHTML = `<div class="empty-state">
      依存関係が登録されていません。<br>
      ガントチャート画面でタスクを開き、「先行タスク」を設定するとここにフローが表示されます。
    </div>`;
  } else {
    container.appendChild(buildFlowSvg(nodes, deps, memberMap));
  }

  // 依存関係なしタスクの一覧
  if (isolated.length > 0) {
    isolatedEl.innerHTML = `
      <h3 class="flow-isolated__title">依存関係のないタスク（${isolated.length}件）</h3>
      <div class="flow-isolated__list">
        ${isolated.map(t => {
          const assignee = t.assignee_id && memberMap[t.assignee_id] ? memberMap[t.assignee_id] : null;
          const days = util.daysBetween(util.parseDate(t.start_date), util.parseDate(t.end_date)) + 1;
          return `
            <a class="flow-isolated__item" href="/projects/${projectId}?openTask=${t.id}">
              ${t.is_milestone ? '<span style="color:var(--color-milestone)">◆</span> ' : ""}
              ${util.escapeHtml(t.name)}
              <span class="flow-isolated__meta">${days}日${assignee ? " / " + util.escapeHtml(assignee.name) : ""}</span>
            </a>`;
        }).join("")}
      </div>
    `;
  }
}

function buildFlowSvg(nodes, deps, memberMap) {
  const nodeIds = new Set(nodes.map(n => n.id));
  // このノード集合内で有効なエッジのみ
  const edges = deps.filter(d => nodeIds.has(d.predecessor_id) && nodeIds.has(d.successor_id));

  // 先行タスクのマップ
  const predsOf = {};
  nodes.forEach(n => { predsOf[n.id] = []; });
  edges.forEach(d => { predsOf[d.successor_id].push(d.predecessor_id); });

  // レイヤー計算（最長パス）: layer = max(先行のlayer) + 1
  const layerMemo = {};
  const layerOf = (id, visiting = new Set()) => {
    if (id in layerMemo) return layerMemo[id];
    if (visiting.has(id)) return 0; // 循環はサーバで防止済み（防御）
    visiting.add(id);
    const preds = predsOf[id];
    const layer = preds.length === 0 ? 0 : Math.max(...preds.map(p => layerOf(p, visiting))) + 1;
    layerMemo[id] = layer;
    return layer;
  };
  nodes.forEach(n => layerOf(n.id));

  // レイヤーごとにグループ化し、開始日順に並べる
  const layers = [];
  nodes.forEach(n => {
    const l = layerMemo[n.id];
    if (!layers[l]) layers[l] = [];
    layers[l].push(n);
  });
  layers.forEach(group => group.sort((a, b) =>
    a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : a.id - b.id));

  // 座標割り当て
  const pos = {};
  layers.forEach((group, li) => {
    group.forEach((n, ri) => {
      pos[n.id] = {
        x: NODE.PAD + li * (NODE.W + NODE.HGAP),
        y: NODE.PAD + ri * (NODE.H + NODE.VGAP),
      };
    });
  });

  const totalW = NODE.PAD * 2 + layers.length * NODE.W + (layers.length - 1) * NODE.HGAP;
  const totalH = NODE.PAD * 2
    + Math.max(...layers.map(g => g.length)) * (NODE.H + NODE.VGAP) - NODE.VGAP;

  const svg = svgEl("svg", { xmlns: SVG_NS, width: totalW, height: totalH });

  // 矢印マーカー
  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "flow-arrow", markerWidth: 10, markerHeight: 10,
    refX: 8, refY: 3.5, orient: "auto",
  });
  marker.appendChild(svgEl("path", { d: "M0,0 L8,3.5 L0,7 Z", fill: "#5b7d9e" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  // エッジ（ベジェ曲線）
  for (const d of edges) {
    const a = pos[d.predecessor_id];
    const b = pos[d.successor_id];
    const x1 = a.x + NODE.W, y1 = a.y + NODE.H / 2;
    const x2 = b.x, y2 = b.y + NODE.H / 2;
    const mx = (x1 + x2) / 2;
    svg.appendChild(svgEl("path", {
      d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 - 3} ${y2}`,
      fill: "none", stroke: "#5b7d9e", "stroke-width": 1.6,
      "marker-end": "url(#flow-arrow)", opacity: 0.85,
    }));
  }

  // ノード
  for (const n of nodes) {
    const { x, y } = pos[n.id];
    const assignee = n.assignee_id && memberMap[n.assignee_id] ? memberMap[n.assignee_id] : null;
    const color = assignee ? assignee.color : "#888780";
    const days = util.daysBetween(util.parseDate(n.start_date), util.parseDate(n.end_date)) + 1;
    const done = n.progress >= 100;

    const g = svgEl("g", { class: "flow-node", "data-task-id": n.id });
    g.style.cursor = "pointer";

    g.appendChild(svgEl("rect", {
      x, y, width: NODE.W, height: NODE.H, rx: 8, ry: 8,
      fill: done ? "#f0f4f0" : "#ffffff",
      stroke: done ? "#8fae8f" : "#b4b2a9", "stroke-width": 1.2,
    }));
    // 担当者色の左帯
    g.appendChild(svgEl("rect", {
      x, y, width: 5, height: NODE.H, rx: 2.5, fill: color,
    }));
    // タスク名
    g.appendChild(svgEl("text", {
      x: x + 14, y: y + 22, "font-size": 12.5, "font-weight": 600,
      fill: done ? "#6a8a6a" : "#2c2c2a",
    }, [
      (n.is_milestone ? "◆ " : "") + truncate(n.name, 14),
    ]));
    // 担当者・日数
    g.appendChild(svgEl("text", {
      x: x + 14, y: y + 40, "font-size": 11, fill: "#6a6964",
    }, [`${assignee ? assignee.name : "未割当"} / ${days}日`]));
    // 進捗
    g.appendChild(svgEl("text", {
      x: x + 14, y: y + 54, "font-size": 11,
      fill: done ? "#0f6e56" : (util.isDelayed(n) ? "#a32d2d" : "#6a6964"),
    }, [done ? "完了" : `進捗 ${n.progress}%${util.isDelayed(n) ? "（遅延）" : ""}`]));

    g.appendChild(svgEl("title", {}, [
      `${n.name}\n${n.start_date} 〜 ${n.end_date}`,
    ]));

    g.addEventListener("click", () => {
      location.href = `/projects/${projectId}?openTask=${n.id}`;
    });

    svg.appendChild(g);
  }

  return svg;
}

// PNG出力
document.getElementById("btn-export-png").addEventListener("click", async () => {
  const svg = document.querySelector("#flow-chart svg");
  if (!svg) {
    util.toast("出力対象のフロー図がありません");
    return;
  }
  try {
    const canvas = await util.svgToCanvas(svg, { scale: 2 });
    const title = document.getElementById("project-title").textContent;
    util.downloadCanvasPng(
      canvas,
      `flow_${util.safeFilename(title)}_${util.formatDate(util.today())}.png`
    );
    util.toast("PNGを出力しました");
  } catch (e) {
    util.toast("PNG出力エラー: " + e.message);
    console.error(e);
  }
});

load().catch(e => {
  document.getElementById("flow-chart").innerHTML =
    `<div class="empty-state">読み込みエラー: ${util.escapeHtml(e.message)}</div>`;
});
