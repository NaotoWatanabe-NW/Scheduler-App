# Scheduler-App

ガントチャート＋イナヅマ線（進捗トレンド）によるプロジェクト管理ツール。FastAPI バックエンド + バニラ JavaScript/SVG フロントエンド構成です。

アプリ本体は [task-app/](task-app/) にあります。機能・セットアップ・API仕様の詳細は [task-app/README.md](task-app/README.md) を参照してください。

## クイックスタート

```bash
# 初回のみ
cd task-app
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd ..

# 起動（Linux / macOS）
./task-app/start.sh
# 起動（Windows）
task-app\start.bat
```

ブラウザで <http://localhost:18234> を開きます。
