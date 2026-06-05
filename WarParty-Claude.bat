@echo off
chcp 65001 >nul
title WarParty - Claude Code
cd /d "C:\Users\alekj\Desktop\Jimmy-Mourad-Web"
echo.
echo   ===========================================
echo    WarParty - startar Claude med full kontext
echo   ===========================================
echo.
claude "Läs in MEMORY.md och de viktigaste minnesfilerna för WarParty innan vi börjar (penetrator_status, penetrator_native_app_plan, penetrator_lessons_learned, penetrator_project, penetrator_br_warzone_meta, penetrator_perf_combat_audit). Ge sedan en kort lägesrapport: aktuell version, vad som är live (native iOS-app + OTA), och vilka nästa steg som är möjliga. Vänta sedan på mina instruktioner."
