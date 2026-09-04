@echo off
chcp 65001 >nul
cd /d %~dp0
title 物料开发认证管理系统（本地版）
where node.exe >nul 2>nul || (echo [错误] 缺少 node.exe，请勿删除本文件。 & pause & exit /b 1)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
  echo [提示] 3000 端口已被占用（进程 %%a），可能系统已在运行，直接打开页面。
  start "" http://localhost:3000/selection.html
  exit /b 0
)
echo 正在启动服务...
start "" node.exe server.js
timeout /t 2 /nobreak >nul
start "" http://localhost:3000/selection.html
