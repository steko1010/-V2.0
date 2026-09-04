@echo off
chcp 65001 >nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
  taskkill /f /pid %%a >nul 2>nul
  echo 已停止服务（进程 %%a）
)
timeout /t 2 /nobreak >nul
