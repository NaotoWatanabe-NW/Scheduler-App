// 共通ユーティリティ

const util = {
  // YYYY-MM-DD 形式の文字列を Date に変換
  parseDate(str) {
    if (!str) return null;
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  },

  // Date を YYYY-MM-DD 文字列に変換
  formatDate(d) {
    if (!d) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  },

  // 2つの日付の日数差（end - start）
  daysBetween(start, end) {
    const ms = end.getTime() - start.getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24));
  },

  // 日付に日数を加算した新しい Date を返す
  addDays(d, days) {
    const result = new Date(d);
    result.setDate(result.getDate() + days);
    return result;
  },

  // 月の最初の日
  startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  },

  // 月の月曜開始の週の最初
  startOfWeek(d) {
    const result = new Date(d);
    const day = result.getDay();
    const diff = (day === 0 ? -6 : 1 - day); // 月曜始まり
    result.setDate(result.getDate() + diff);
    return result;
  },

  // 今日（時刻なし）
  today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  },

  // ===== 進捗の計画値と遅延判定 =====

  // 基準日時点での計画進捗（0-100）。
  // 「今日の開始時点で終わっているべき割合」= 経過日数（今日を含まない） / 期間
  plannedProgress(startStr, endStr, todayDate) {
    const start = this.parseDate(startStr);
    const end = this.parseDate(endStr);
    const t = todayDate || this.today();
    if (t <= start) return 0;
    if (t > end) return 100;
    const total = this.daysBetween(start, end) + 1;
    const elapsed = this.daysBetween(start, t);
    return Math.round((elapsed / total) * 100);
  },

  // 実績進捗が計画進捗を下回っていれば遅延
  isDelayed(task, todayDate) {
    if (task.progress >= 100) return false;
    return task.progress < this.plannedProgress(task.start_date, task.end_date, todayDate);
  },

  // ===== 日本の祝日・営業日 =====

  _holidayCache: {},

  // 指定年の祝日を "YYYY-MM-DD" の Set で返す（1980〜2099年で有効な近似計算）
  jpHolidays(year) {
    if (this._holidayCache[year]) return this._holidayCache[year];
    const set = new Set();
    const add = (m, d) =>
      set.add(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    // 第n月曜日の日付
    const nthMonday = (m, n) => {
      const first = new Date(year, m - 1, 1);
      return 1 + ((8 - first.getDay()) % 7) + (n - 1) * 7;
    };

    add(1, 1);                    // 元日
    add(1, nthMonday(1, 2));      // 成人の日
    add(2, 11);                   // 建国記念の日
    add(2, 23);                   // 天皇誕生日
    add(3, Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))); // 春分の日
    add(4, 29);                   // 昭和の日
    add(5, 3); add(5, 4); add(5, 5); // 憲法記念日・みどりの日・こどもの日
    add(7, nthMonday(7, 3));      // 海の日
    add(8, 11);                   // 山の日
    add(9, nthMonday(9, 3));      // 敬老の日
    add(9, Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))); // 秋分の日
    add(10, nthMonday(10, 2));    // スポーツの日
    add(11, 3);                   // 文化の日
    add(11, 23);                  // 勤労感謝の日

    // 振替休日: 日曜に当たった祝日の直後の平日（非祝日）
    for (const key of Array.from(set)) {
      const d = this.parseDate(key);
      if (d.getDay() === 0) {
        let sub = this.addDays(d, 1);
        while (set.has(this.formatDate(sub)) || sub.getDay() === 0) {
          sub = this.addDays(sub, 1);
        }
        set.add(this.formatDate(sub));
      }
    }
    // 国民の休日: 前後を祝日に挟まれた平日
    for (const key of Array.from(set)) {
      const d = this.parseDate(key);
      if (set.has(this.formatDate(this.addDays(d, 2)))) {
        const mid = this.addDays(d, 1);
        const midKey = this.formatDate(mid);
        if (!set.has(midKey) && mid.getDay() !== 0) set.add(midKey);
      }
    }

    this._holidayCache[year] = set;
    return set;
  },

  isJpHoliday(d) {
    return this.jpHolidays(d.getFullYear()).has(this.formatDate(d));
  },

  // 土日または祝日
  isNonWorkingDay(d) {
    const w = d.getDay();
    return w === 0 || w === 6 || this.isJpHoliday(d);
  },

  // start〜end（両端含む）の営業日数
  businessDaysBetween(start, end) {
    let count = 0;
    let cur = new Date(start);
    while (cur <= end) {
      if (!this.isNonWorkingDay(cur)) count++;
      cur = this.addDays(cur, 1);
    }
    return count;
  },

  // トーストメッセージ
  toast(message, duration = 2500) {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
  },

  // 確認ダイアログ
  confirm(message) {
    return window.confirm(message);
  },

  // URL クエリパラメータから取得
  queryParam(name) {
    return new URLSearchParams(location.search).get(name);
  },

  // パスから ID 抽出（/projects/123 → 123）
  pathId(prefix) {
    const m = location.pathname.match(new RegExp(`^${prefix}/(\\d+)`));
    return m ? Number(m[1]) : null;
  },

  // HTMLエスケープ
  escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  },

  // ===== PNG出力 =====

  // SVG要素を描画済みcanvasに変換する（scale倍で高解像度化）
  async svgToCanvas(svgEl, { scale = 2, background = "#ffffff" } = {}) {
    const w = svgEl.width.baseVal.value;
    const h = svgEl.height.baseVal.value;
    const clone = svgEl.cloneNode(true);
    clone.setAttribute("width", w);
    clone.setAttribute("height", h);
    // 単体SVGにはページのCSSが効かないため、フォントを明示する
    clone.setAttribute(
      "style",
      "font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans JP','Hiragino Sans',Meiryo,sans-serif;"
    );
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("SVG画像の変換に失敗しました"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(w * scale);
      canvas.height = Math.ceil(h * scale);
      const ctx = canvas.getContext("2d");
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  // canvasをPNGとしてダウンロード
  downloadCanvasPng(canvas, filename) {
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  },

  // ファイル名に使えない文字を除去
  safeFilename(s) {
    return String(s).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
  },
};

window.util = util;

// ===== ログインユーザー表示（全ページ共通） =====
// ヘッダーのナビにユーザー名とログアウトリンクを追加する。
// 未ログインならログインページへリダイレクト（/login 自身では何もしない）。
(function initAuthHeader() {
  if (location.pathname.startsWith("/login")) return;
  fetch("/api/auth/me")
    .then(res => {
      if (res.status === 401) {
        location.href = "/login";
        return null;
      }
      return res.ok ? res.json() : null;
    })
    .then(user => {
      if (!user) return;
      const nav = document.querySelector(".app-header nav");
      if (!nav) return;
      const span = document.createElement("span");
      span.className = "nav-user";
      span.textContent = `👤 ${user.username}`;
      const logout = document.createElement("a");
      logout.href = "#";
      logout.textContent = "ログアウト";
      logout.addEventListener("click", async (e) => {
        e.preventDefault();
        await fetch("/api/auth/logout", { method: "POST" });
        location.href = "/login";
      });
      nav.appendChild(span);
      nav.appendChild(logout);
    })
    .catch(() => { /* オフライン等は無視 */ });
})();
