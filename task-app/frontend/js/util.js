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
};

window.util = util;
