#!/bin/bash
# Task App 起動スクリプト (Linux / macOS)

# このスクリプトが置かれているディレクトリに移動（どこから実行しても動く）
cd "$(dirname "$0")"

# 仮想環境が存在すれば有効化（.venv または venv）
if [ -d ".venv" ]; then
  source .venv/bin/activate
elif [ -d "venv" ]; then
  source venv/bin/activate
fi

# 起動
python -m uvicorn backend.main:app --host 127.0.0.1 --port 18234
