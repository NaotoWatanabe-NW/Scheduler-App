@echo off
rem Task App 起動スクリプト (Windows)

rem このスクリプトが置かれているディレクトリに移動（どこから実行しても動く）
cd /d "%~dp0"

rem 仮想環境が存在すれば有効化（.venv または venv）
if exist ".venv\Scripts\activate.bat" (
  call .venv\Scripts\activate.bat
) else if exist "venv\Scripts\activate.bat" (
  call venv\Scripts\activate.bat
)

rem 起動
python -m uvicorn backend.main:app --host 127.0.0.1 --port 18234
