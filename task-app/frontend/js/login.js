// ログイン／ユーザー登録画面

let mode = "login"; // "login" | "register"

const titleEl = document.getElementById("login-title");
const submitBtn = document.getElementById("btn-login");
const switchText = document.getElementById("switch-text");
const switchLink = document.getElementById("switch-mode");
const errorEl = document.getElementById("login-error");

function applyMode() {
  const isLogin = mode === "login";
  titleEl.textContent = isLogin ? "ログイン" : "新規登録";
  submitBtn.textContent = isLogin ? "ログイン" : "登録してはじめる";
  switchText.textContent = isLogin ? "アカウントがない場合:" : "既にアカウントがある場合:";
  switchLink.textContent = isLogin ? "新規登録" : "ログイン";
  errorEl.textContent = "";
}

switchLink.addEventListener("click", (e) => {
  e.preventDefault();
  mode = mode === "login" ? "register" : "login";
  applyMode();
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const fd = new FormData(e.target);
  try {
    await api.post(`/auth/${mode}`, {
      username: fd.get("username").trim(),
      password: fd.get("password"),
    });
    location.href = "/";
  } catch (err) {
    // APIエラーメッセージ（detail）を取り出して表示
    const m = err.message.match(/\{"detail":"([^"]+)"\}/);
    errorEl.textContent = m ? m[1] : "エラーが発生しました: " + err.message;
  }
});

// ログイン済みならトップへ
fetch("/api/auth/me").then(res => {
  if (res.ok) location.href = "/";
});

applyMode();
