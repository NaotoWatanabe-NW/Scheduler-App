// API呼び出しの共通ヘルパー（フェーズ2以降で本格利用）

const api = {
  async request(method, path, body = null) {
    const opts = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body !== null) opts.body = JSON.stringify(body);
    const res = await fetch(`/api${path}`, opts);
    if (!res.ok) {
      // 未ログイン（セッション切れ）はログインページへ（ログイン画面自身は除く）
      if (res.status === 401 && !location.pathname.startsWith("/login") && !path.startsWith("/auth/")) {
        location.href = "/login";
      }
      const text = await res.text();
      throw new Error(`API ${method} ${path} failed: ${res.status} ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  },
  get(path) { return this.request("GET", path); },
  post(path, body) { return this.request("POST", path, body); },
  put(path, body) { return this.request("PUT", path, body); },
  del(path) { return this.request("DELETE", path); },
};

// グローバルに公開
window.api = api;
