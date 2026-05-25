// ガントチャートのSVG描画エンジン
//
// 設計原則:
// - データ → calculateLayout() → renderGantt() を毎回ゼロから実行
// - 座標は全て関数で算出（Y=index*ROW_HEIGHT, X=dayDiff*DAY_WIDTH）
// - 固定座標のハードコードなし
// - タスク追加・削除でもズレない

const SVG_NS = "http://www.w3.org/2000/svg";

// レイアウト定数
const LAYOUT = {
  ROW_HEIGHT: 32,
  HEADER_HEIGHT: 60,
  BAR_HEIGHT: 20,
  BAR_Y_OFFSET: 6,         // 行内の上端からのオフセット
  MILESTONE_SIZE: 10,
  CHILD_INDENT: 16,        // 階層インデント幅
  MIN_BAR_WIDTH: 3,
};

const ZOOM = {
  day: { dayWidth: 28, label: "日" },
  week: { dayWidth: 8, label: "週" },
  month: { dayWidth: 3, label: "月" },
};

// ===== レイアウト計算 =====

/**
 * 階層構造のタスクツリーをフラットなリストに変換し、各タスクに座標を付与する。
 * @param {Array} tree タスクツリー（API /api/projects/{id}/tasks から取得した形式）
 * @param {Object} options { dayWidth, viewStart }
 * @returns {Object} { tasks: [...], totalHeight, totalWidth }
 */
function calculateLayout(tree, options) {
  const { dayWidth, viewStart, viewEnd } = options;
  const flat = [];

  // 木をDFSで平坦化（既に start_date 昇順でソート済み）
  const walk = (nodes, depth, parentId) => {
    for (const node of nodes) {
      // _hasChildren があればそれを使う（折りたたまれていても元の子の有無を保持）
      const hasChildren = node._hasChildren !== undefined
        ? node._hasChildren
        : node.children.length > 0;
      flat.push({ ...node, depth, hasChildren });
      if (node.children.length > 0) {
        walk(node.children, depth + 1, node.id);
      }
    }
  };
  walk(tree, 0, null);

  // 各タスクに座標を付与
  const tasks = flat.map((task, index) => {
    const start = util.parseDate(task.start_date);
    const end = util.parseDate(task.end_date);

    const barX = util.daysBetween(viewStart, start) * dayWidth;
    const barEndX = (util.daysBetween(viewStart, end) + 1) * dayWidth; // +1で期日当日を含む
    const barWidth = Math.max(barEndX - barX, LAYOUT.MIN_BAR_WIDTH);
    const progressX = barX + barWidth * (task.progress / 100);

    return {
      ...task,
      rowIndex: index,
      y: LAYOUT.HEADER_HEIGHT + index * LAYOUT.ROW_HEIGHT,
      barX,
      barWidth,
      progressX,
    };
  });

  const totalHeight = LAYOUT.HEADER_HEIGHT + tasks.length * LAYOUT.ROW_HEIGHT;
  const totalDays = util.daysBetween(viewStart, viewEnd) + 1;
  const totalWidth = totalDays * dayWidth;

  return { tasks, totalHeight, totalWidth };
}

// ===== SVG要素生成ヘルパー =====

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

// ===== 日付ヘッダ描画 =====

function renderDateHeader(layout, options) {
  const { dayWidth, viewStart, viewEnd, zoomLevel } = options;
  const g = svgEl("g", { class: "gantt-header" });

  // 背景
  g.appendChild(svgEl("rect", {
    x: 0, y: 0,
    width: layout.totalWidth,
    height: LAYOUT.HEADER_HEIGHT,
    fill: "#faf9f4",
  }));

  // 日付ラベル：ズームレベルに応じて粒度を変える
  const totalDays = util.daysBetween(viewStart, viewEnd) + 1;

  if (zoomLevel === "day") {
    // 日単位：月の境界に縦線、各日にラベル
    for (let i = 0; i < totalDays; i++) {
      const d = util.addDays(viewStart, i);
      const x = i * dayWidth;
      // 月初に月ラベル
      if (d.getDate() === 1 || i === 0) {
        g.appendChild(svgEl("text", {
          x: x + 4, y: 20,
          "font-size": 12, "font-weight": 500, fill: "#444",
        }, [`${d.getFullYear()}/${d.getMonth() + 1}`]));
        g.appendChild(svgEl("line", {
          x1: x, y1: 0, x2: x, y2: layout.totalHeight,
          stroke: "#c0bcb0", "stroke-width": 1,
        }));
      }
      // 日ラベル
      g.appendChild(svgEl("text", {
        x: x + dayWidth / 2, y: 44,
        "font-size": 11, fill: "#666",
        "text-anchor": "middle",
      }, [String(d.getDate())]));

      // 週末の薄い背景
      if (d.getDay() === 0 || d.getDay() === 6) {
        g.appendChild(svgEl("rect", {
          x, y: LAYOUT.HEADER_HEIGHT,
          width: dayWidth, height: layout.totalHeight - LAYOUT.HEADER_HEIGHT,
          fill: "#f5f3eb",
        }));
      }
    }
  } else if (zoomLevel === "week") {
    // 週単位：月境界＋週ごとの目盛
    let cursor = util.startOfWeek(viewStart);
    while (cursor <= viewEnd) {
      const i = util.daysBetween(viewStart, cursor);
      const x = i * dayWidth;
      if (cursor.getDate() <= 7) {
        // 月の最初の週
        g.appendChild(svgEl("text", {
          x: x + 4, y: 20,
          "font-size": 12, "font-weight": 500, fill: "#444",
        }, [`${cursor.getFullYear()}/${cursor.getMonth() + 1}`]));
        g.appendChild(svgEl("line", {
          x1: x, y1: 0, x2: x, y2: layout.totalHeight,
          stroke: "#c0bcb0", "stroke-width": 1,
        }));
      }
      // 週の月曜にラベル
      if (dayWidth >= 7) {
        g.appendChild(svgEl("text", {
          x: x + dayWidth * 3.5, y: 44,
          "font-size": 10, fill: "#666",
          "text-anchor": "middle",
        }, [`${cursor.getMonth() + 1}/${cursor.getDate()}`]));
      }
      cursor = util.addDays(cursor, 7);
    }
  } else {
    // 月単位：月の境界のみ
    let cursor = util.startOfMonth(viewStart);
    while (cursor <= viewEnd) {
      const i = util.daysBetween(viewStart, cursor);
      const x = i * dayWidth;
      g.appendChild(svgEl("text", {
        x: x + 4, y: 30,
        "font-size": 12, "font-weight": 500, fill: "#444",
      }, [`${cursor.getFullYear()}/${cursor.getMonth() + 1}`]));
      g.appendChild(svgEl("line", {
        x1: x, y1: 0, x2: x, y2: layout.totalHeight,
        stroke: "#c0bcb0", "stroke-width": 1,
      }));
      // 翌月へ
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }

  // ヘッダ下の境界線
  g.appendChild(svgEl("line", {
    x1: 0, y1: LAYOUT.HEADER_HEIGHT,
    x2: layout.totalWidth, y2: LAYOUT.HEADER_HEIGHT,
    stroke: "#c0bcb0", "stroke-width": 1,
  }));

  // 今日の縦線
  const today = util.today();
  if (today >= viewStart && today <= viewEnd) {
    const todayX = util.daysBetween(viewStart, today) * dayWidth;
    g.appendChild(svgEl("line", {
      x1: todayX, y1: 0,
      x2: todayX, y2: layout.totalHeight,
      stroke: "#185fa5", "stroke-width": 1, "stroke-dasharray": "3 3",
      opacity: 0.5,
    }));
  }

  return g;
}

// ===== タスク行（バー、マイルストーン）描画 =====

function renderTaskRows(layout, options, members) {
  const { dayWidth } = options;
  const g = svgEl("g", { class: "gantt-rows" });

  // メンバーIDから色を引くマップ
  const memberColor = {};
  members.forEach(m => { memberColor[m.id] = m.color; });

  for (const task of layout.tasks) {
    // 行のホバーハイライト用の透明背景
    g.appendChild(svgEl("rect", {
      x: 0, y: task.y,
      width: layout.totalWidth, height: LAYOUT.ROW_HEIGHT,
      fill: "transparent",
      class: "gantt-row-bg",
      "data-task-id": task.id,
    }));

    // 行下線
    g.appendChild(svgEl("line", {
      x1: 0, y1: task.y + LAYOUT.ROW_HEIGHT,
      x2: layout.totalWidth, y2: task.y + LAYOUT.ROW_HEIGHT,
      stroke: "#f0eee6", "stroke-width": 1,
    }));

    if (task.hasChildren) {
      // 親タスク: バーは描画しない（グループ見出し扱い）
      continue;
    }

    const barY = task.y + LAYOUT.BAR_Y_OFFSET;
    const barColor = task.assignee_id && memberColor[task.assignee_id]
      ? memberColor[task.assignee_id]
      : "#888780";

    if (task.is_milestone) {
      // マイルストーン: ◆
      const cx = task.barX + (task.barWidth / 2);
      const cy = barY + LAYOUT.BAR_HEIGHT / 2;
      const s = LAYOUT.MILESTONE_SIZE;
      const points = `${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`;
      const milestone = svgEl("polygon", {
        points,
        fill: "#993556",
        stroke: "#4B1528",
        "stroke-width": 1,
        class: "gantt-milestone",
        "data-task-id": task.id,
      });
      milestone.style.cursor = "pointer";
      g.appendChild(milestone);
    } else {
      // 通常タスク: 背景バー + 進捗バー
      const bgBar = svgEl("rect", {
        x: task.barX, y: barY,
        width: task.barWidth, height: LAYOUT.BAR_HEIGHT,
        rx: 3, ry: 3,
        fill: barColor, opacity: 0.4,
        stroke: barColor, "stroke-width": 0.5,
        "data-task-id": task.id,
        class: "gantt-bar-bg",
      });
      bgBar.style.cursor = "pointer";
      g.appendChild(bgBar);

      const progressWidth = task.barWidth * (task.progress / 100);
      if (progressWidth > 0) {
        const progBar = svgEl("rect", {
          x: task.barX, y: barY,
          width: progressWidth, height: LAYOUT.BAR_HEIGHT,
          rx: 3, ry: 3,
          fill: barColor,
          "pointer-events": "none",
          class: "gantt-bar-progress",
        });
        g.appendChild(progBar);
      }

      // 進捗％ラベル（バーが十分広い場合のみ）
      if (task.barWidth > 40) {
        g.appendChild(svgEl("text", {
          x: task.barX + task.barWidth / 2,
          y: barY + LAYOUT.BAR_HEIGHT / 2 + 4,
          "font-size": 10, fill: "#fff",
          "text-anchor": "middle",
          "pointer-events": "none",
        }, [`${task.progress}%`]));
      }
    }
  }

  return g;
}

// ===== イナヅマ線描画 =====

/**
 * @param {Array} snapshots スナップショット配列（新しい順）
 * @param {Object} layout calculateLayoutの結果
 * @param {Object} options { dayWidth, viewStart, snapshotCount }
 */
function renderInazumaLines(snapshots, layout, options) {
  const { dayWidth, viewStart, snapshotCount } = options;
  const g = svgEl("g", { class: "gantt-inazuma" });

  // 表示するスナップショット数を絞る（新しい順から取る）
  const targetSnaps = snapshots.slice(0, snapshotCount).reverse(); // 古い→新しい順に描画

  // タスクIDから layout 内のタスクオブジェクトを引くマップ
  const taskMap = {};
  layout.tasks.forEach(t => { taskMap[t.id] = t; });

  // 基準日ラベルの重なり判定：同一X座標近傍に既に置いたラベルがあれば縦にずらす
  const labelXs = [];

  targetSnaps.forEach((snap, idx) => {
    const isLatest = idx === targetSnaps.length - 1;
    const n = targetSnaps.length;
    // 透明度: 古いものほど薄く、最新は濃く（イージング）
    // n-1=1のとき最新だけ → 1.0、複数あるときは古いものは0.2〜0.35程度
    let opacity;
    if (isLatest) {
      opacity = 1.0;
    } else {
      const t = n > 1 ? idx / (n - 1) : 1;
      // ease-in カーブ（古いほど急速に薄く）
      opacity = 0.2 + 0.55 * (t * t);
    }
    const strokeWidth = isLatest ? 2 : 1.5;
    const color = "#A32D2D";
    const pointR = isLatest ? 3.5 : 2.5;

    const snapDate = util.parseDate(snap.snapshot_date);
    const baseX = util.daysBetween(viewStart, snapDate) * dayWidth;

    // 基準日の縦線
    g.appendChild(svgEl("line", {
      x1: baseX, y1: LAYOUT.HEADER_HEIGHT,
      x2: baseX, y2: layout.totalHeight,
      stroke: color, "stroke-width": 1,
      "stroke-dasharray": "4 3",
      opacity: opacity * 0.4,
    }));

    // 基準日ラベル（重なり対策で縦オフセット）
    let labelY = LAYOUT.HEADER_HEIGHT - 4;
    for (const prev of labelXs) {
      if (Math.abs(prev.x - baseX) < 36 && prev.y === labelY) {
        labelY -= 14; // 上にずらす
      }
    }
    labelXs.push({ x: baseX, y: labelY });

    // ラベル背景（読みやすさのため小さな白背景）
    const labelText = snap.snapshot_date.slice(5); // MM-DD
    g.appendChild(svgEl("rect", {
      x: baseX - 18, y: labelY - 10,
      width: 36, height: 12,
      fill: "#faf9f4",
      opacity: opacity * 0.9,
    }));
    g.appendChild(svgEl("text", {
      x: baseX, y: labelY,
      "font-size": 10, fill: color,
      "text-anchor": "middle",
      "font-weight": isLatest ? 500 : 400,
      opacity,
    }, [labelText]));

    // 各タスクの進捗到達点を計算してポリライン作成
    const points = [];
    const progMap = {};
    snap.task_progresses.forEach(tp => { progMap[tp.task_id] = tp.progress; });

    for (const task of layout.tasks) {
      if (task.hasChildren) continue; // 親タスクは飛ばす
      if (!(task.id in progMap)) continue;

      const progress = progMap[task.id];
      const taskStart = util.parseDate(task.start_date);

      // 基準日X上に点を置くのは「タスク開始日が基準日より未来 かつ 進捗0%」のときだけ。
      // つまり「まだ開始予定も来ていない、未着手」状態。これは「予定通り」とみなす。
      //
      // 開始日が来ているのに進捗0%のタスクは、タスク開始位置（barX、進捗0%地点）に
      // 点を打つことで、左に大きく凹む形（遅延）として表現される。
      const isNotYetDue = taskStart > snapDate && progress === 0;
      const px = isNotYetDue
        ? baseX
        : task.barX + task.barWidth * (progress / 100);
      const py = task.y + LAYOUT.ROW_HEIGHT / 2;

      // 進捗到達点に点を打つ
      g.appendChild(svgEl("circle", {
        cx: px, cy: py, r: pointR,
        fill: color, opacity,
        stroke: isLatest ? "#fff" : "none",
        "stroke-width": isLatest ? 1 : 0,
      }));
      points.push(`${px},${py}`);
    }

    // ポリラインで結ぶ
    if (points.length >= 2) {
      g.appendChild(svgEl("polyline", {
        points: points.join(" "),
        fill: "none",
        stroke: color,
        "stroke-width": strokeWidth,
        opacity,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      }));
    }
  });

  return g;
}

// ===== メインのレンダリング関数 =====

/**
 * ガントチャート全体を描画する。
 *
 * @param {HTMLElement} svgContainer SVGを挿入するコンテナ要素
 * @param {Array} taskTree 階層化されたタスクツリー
 * @param {Array} snapshots スナップショット配列（新しい順）
 * @param {Array} members メンバー配列
 * @param {Object} options { zoomLevel, viewStart, viewEnd, snapshotCount, showInazuma, onTaskClick }
 */
function renderGantt(svgContainer, taskTree, snapshots, members, options) {
  // 既存のSVGをクリア
  svgContainer.innerHTML = "";

  const zoomLevel = options.zoomLevel || "day";
  const dayWidth = ZOOM[zoomLevel].dayWidth;
  const viewStart = options.viewStart;
  const viewEnd = options.viewEnd;

  const layoutOpts = { dayWidth, viewStart, viewEnd };
  const layout = calculateLayout(taskTree, layoutOpts);

  if (layout.tasks.length === 0) {
    const msg = document.createElement("div");
    msg.className = "empty-state";
    msg.textContent = "タスクがありません。「+ タスク追加」から作成してください。";
    svgContainer.appendChild(msg);
    return { layout, tasks: [] };
  }

  // SVG ルート作成
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    width: layout.totalWidth,
    height: layout.totalHeight,
  });

  // 1. 日付ヘッダ
  svg.appendChild(renderDateHeader(layout, { dayWidth, viewStart, viewEnd, zoomLevel }));

  // 2. タスク行＆バー
  svg.appendChild(renderTaskRows(layout, { dayWidth }, members));

  // 3. イナヅマ線（オプション）
  if (options.showInazuma && snapshots.length > 0) {
    svg.appendChild(renderInazumaLines(snapshots, layout, {
      dayWidth, viewStart,
      snapshotCount: options.snapshotCount || 4,
    }));
  }

  svgContainer.appendChild(svg);

  // クリックイベント
  if (options.onTaskClick) {
    svg.querySelectorAll("[data-task-id]").forEach(el => {
      el.addEventListener("click", (e) => {
        const id = Number(el.dataset.taskId);
        const task = layout.tasks.find(t => t.id === id);
        if (task) options.onTaskClick(task);
      });
    });
  }

  return { layout };
}

// グローバルに公開
window.gantt = { renderGantt, calculateLayout, LAYOUT, ZOOM };
