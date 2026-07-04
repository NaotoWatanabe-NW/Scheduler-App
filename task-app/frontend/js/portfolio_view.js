// 統合プロジェクト表示画面（閲覧専用）
//
// バックエンドの /api/portfolios/{id}/summary が返す集計を、
// 「1プロジェクト = 1つの疑似タスク」として gantt.js にそのまま渡して描画する。
// 進捗点（イナヅマ）は基準日=今日の疑似スナップショット1本として描く。
// 編集操作は一切なし。バークリックで各プロジェクトのガント画面へ移動する。

const portfolioId = util.pathId("/portfolios");

const state = {
  summary: null,
  zoomLevel: "week",
  chartProjects: [],   // バーを描けるプロジェクト（日付あり）
  skipped: [],         // 日付が決められないプロジェクト
};

async function loadData() {
  state.summary = await api.get(`/portfolios/${portfolioId}/summary`);
  state.chartProjects = state.summary.projects.filter(p => p.start_date && p.end_date);
  state.skipped = state.summary.projects.filter(p => !p.start_date || !p.end_date);

  // 期間が長い場合はズームを自動で粗くする
  if (state.chartProjects.length > 0) {
    const minStart = state.chartProjects.reduce((a, p) => a < p.start_date ? a : p.start_date, "9999");
    const maxEnd = state.chartProjects.reduce((a, p) => a > p.end_date ? a : p.end_date, "0000");
    const span = util.daysBetween(util.parseDate(minStart), util.parseDate(maxEnd));
    state.zoomLevel = span > 180 ? "month" : span > 45 ? "week" : "day";
    document.getElementById("zoom-select").value = state.zoomLevel;
  }
}

// プロジェクト集計 → gantt.js が扱える疑似タスクへ変換
function toPseudoTasks() {
  return state.chartProjects.map(p => ({
    id: p.project_id,
    name: p.name,
    start_date: p.start_date,
    end_date: p.end_date,
    progress: p.progress_percent ?? 0,
    is_milestone: false,
    assignee_id: null,
    parent_task_id: null,
    children: [],
  }));
}

// 進捗点を「基準日=今日の疑似スナップショット」としてイナヅマ描画に渡す
function toPseudoSnapshot() {
  return {
    snapshot_date: state.summary.base_date,
    task_progresses: state.chartProjects
      .filter(p => p.progress_percent != null)
      .map(p => ({ task_id: p.project_id, progress: p.progress_percent })),
  };
}

function getViewRange(pseudoTasks) {
  let start = null, end = null;
  for (const t of pseudoTasks) {
    const s = util.parseDate(t.start_date);
    const e = util.parseDate(t.end_date);
    if (!start || s < start) start = s;
    if (!end || e > end) end = e;
  }
  const today = util.today();
  if (!start) start = util.addDays(today, -7);
  if (!end) end = util.addDays(today, 14);
  if (today < start) start = today;
  if (today > end) end = today;
  return { viewStart: util.addDays(start, -3), viewEnd: util.addDays(end, 3) };
}

function statusHtml(p) {
  if (p.progress_percent == null) {
    return `<span style="color:var(--color-text-muted)">タスクなし</span>`;
  }
  if (p.is_completed || p.progress_percent >= 100) {
    return `<span style="color:var(--color-success)">完了</span>`;
  }
  const tip = p.bottleneck_task
    ? ` title="最遅タスク: ${util.escapeHtml(p.bottleneck_task)}"` : "";
  if (p.delay_days > 0) {
    return `<span class="progress--delayed"${tip}>${p.delay_days}日遅れ</span>`;
  }
  if (p.delay_days < 0) {
    return `<span style="color:var(--color-primary)"${tip}>${-p.delay_days}日先行</span>`;
  }
  return `<span style="color:var(--color-success)"${tip}>順調</span>`;
}

function render() {
  document.getElementById("portfolio-title").textContent = state.summary.name;
  document.title = `Task App - 統合 - ${state.summary.name}`;
  document.getElementById("base-date-label").textContent =
    `基準日: ${state.summary.base_date}`;

  // 日付が決められないプロジェクトの注記
  const noteEl = document.getElementById("skipped-note");
  noteEl.innerHTML = state.skipped.length
    ? `<div style="font-size:12px;color:var(--color-text-muted);margin-bottom:8px;">
         表示できないプロジェクト（タスク・日付なし）:
         ${state.skipped.map(p => `<a href="/projects/${p.project_id}">${util.escapeHtml(p.name)}</a>`).join("、 ")}
       </div>`
    : "";

  const pseudoTasks = toPseudoTasks();

  // 左ペイン
  const rowsEl = document.getElementById("task-rows");
  if (state.chartProjects.length === 0) {
    rowsEl.innerHTML = `<div class="empty-state" style="padding:24px;">表示できるプロジェクトがありません</div>`;
    document.getElementById("gantt-chart").innerHTML = "";
    return;
  }
  rowsEl.innerHTML = state.chartProjects.map(p => `
    <div class="gantt-task-row">
      <div class="gantt-task-row__name" data-project-id="${p.project_id}">
        <span class="task-toggle-spacer"></span><span class="task-name-text">${util.escapeHtml(p.name)}</span>
      </div>
      <div class="gantt-task-row__assignee">${statusHtml(p)}</div>
      <div class="gantt-task-row__progress">${p.progress_percent != null ? p.progress_percent + "%" : "—"}</div>
    </div>
  `).join("");
  rowsEl.querySelectorAll("[data-project-id]").forEach(el => {
    el.addEventListener("click", () => {
      location.href = `/projects/${el.dataset.projectId}`;
    });
  });

  // 右ペイン: ガント（閲覧専用なので onTaskUpdate は渡さない = ドラッグ無効）
  const { viewStart, viewEnd } = getViewRange(pseudoTasks);
  gantt.renderGantt(
    document.getElementById("gantt-chart"),
    pseudoTasks,
    [toPseudoSnapshot()],
    [],  // メンバー色は使わない（全バー同色）
    {
      zoomLevel: state.zoomLevel,
      viewStart,
      viewEnd,
      showInazuma: true,
      snapshotCount: 1,
      onTaskClick: (task) => { location.href = `/projects/${task.id}`; },
    }
  );
}

async function loadAndRender() {
  try {
    await loadData();
    render();
  } catch (e) {
    document.getElementById("task-rows").innerHTML =
      `<div class="empty-state" style="padding:24px;">読み込みエラー: ${util.escapeHtml(e.message)}</div>`;
    console.error(e);
  }
}

document.getElementById("zoom-select").addEventListener("change", (e) => {
  state.zoomLevel = e.target.value;
  render();
});

// PNG出力（プロジェクト名・状態・進捗の左ペイン付き）
document.getElementById("btn-export-png").addEventListener("click", async () => {
  const svg = document.querySelector("#gantt-chart svg");
  if (!svg) {
    util.toast("出力対象のチャートがありません");
    return;
  }
  try {
    const SCALE = 2;
    const PANE_W = 300;
    const { ROW_HEIGHT, HEADER_HEIGHT } = gantt.LAYOUT;
    const chartCanvas = await util.svgToCanvas(svg, { scale: SCALE });
    const height = svg.height.baseVal.value;

    const canvas = document.createElement("canvas");
    canvas.width = PANE_W * SCALE + chartCanvas.width;
    canvas.height = Math.ceil(height * SCALE);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(SCALE, SCALE);
    const font = "-apple-system,'Segoe UI',Roboto,'Noto Sans JP','Hiragino Sans',Meiryo,sans-serif";
    ctx.fillStyle = "#2c2c2a";
    ctx.font = `600 13px ${font}`;
    ctx.fillText(`${state.summary.name}（基準日: ${state.summary.base_date}）`, 8, 20);
    ctx.fillStyle = "#6a6964";
    ctx.font = `11px ${font}`;
    ctx.fillText("プロジェクト", 8, HEADER_HEIGHT - 8);
    ctx.fillText("状態", 190, HEADER_HEIGHT - 8);
    ctx.fillText("進捗", 262, HEADER_HEIGHT - 8);

    state.chartProjects.forEach((p, i) => {
      const y = HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2 + 4;
      ctx.fillStyle = "#2c2c2a";
      ctx.font = `12px ${font}`;
      let name = p.name;
      if (name.length > 13) name = name.slice(0, 12) + "…";
      ctx.fillText(name, 8, y);
      // 状態
      ctx.font = `11px ${font}`;
      let status, color;
      if (p.progress_percent == null) { status = "—"; color = "#6a6964"; }
      else if (p.is_completed || p.progress_percent >= 100) { status = "完了"; color = "#0f6e56"; }
      else if (p.delay_days > 0) { status = `${p.delay_days}日遅れ`; color = "#a32d2d"; }
      else if (p.delay_days < 0) { status = `${-p.delay_days}日先行`; color = "#185fa5"; }
      else { status = "順調"; color = "#0f6e56"; }
      ctx.fillStyle = color;
      ctx.fillText(status, 190, y);
      ctx.fillStyle = "#2c2c2a";
      ctx.fillText(p.progress_percent != null ? `${p.progress_percent}%` : "—", 262, y);
      ctx.strokeStyle = "#f0eee6";
      ctx.beginPath();
      ctx.moveTo(0, HEADER_HEIGHT + (i + 1) * ROW_HEIGHT);
      ctx.lineTo(PANE_W, HEADER_HEIGHT + (i + 1) * ROW_HEIGHT);
      ctx.stroke();
    });
    ctx.strokeStyle = "#c0bcb0";
    ctx.beginPath();
    ctx.moveTo(PANE_W - 0.5, 0);
    ctx.lineTo(PANE_W - 0.5, height);
    ctx.stroke();
    ctx.restore();

    ctx.drawImage(chartCanvas, PANE_W * SCALE, 0);

    util.downloadCanvasPng(
      canvas,
      `portfolio_${util.safeFilename(state.summary.name)}_${util.formatDate(util.today())}.png`
    );
    util.toast("PNGを出力しました");
  } catch (e) {
    util.toast("PNG出力エラー: " + e.message);
    console.error(e);
  }
});

loadAndRender();
