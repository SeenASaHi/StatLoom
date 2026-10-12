@echo off
rem StatLoom prototype launcher: serve this folder over HTTP and open the browser.
rem ES Modules require http:// (file:// is blocked by browsers).
cd /d "%~dp0"
start "" "http://localhost:8124/"
python -m http.server 8124
