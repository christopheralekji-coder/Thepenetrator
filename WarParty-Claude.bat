@echo off
title WarParty - Claude Code
cd /d "C:\Users\alekj\Desktop\Jimmy-Mourad-Web"
echo.
echo   ===========================================
echo    WarParty - startar Claude med full kontext
echo   ===========================================
echo.

call claude "Las in MEMORY.md och de viktigaste minnesfilerna for WarParty innan vi borjar (penetrator_status, penetrator_native_app_plan, penetrator_lessons_learned, penetrator_project, penetrator_br_warzone_meta, penetrator_perf_combat_audit). Ge sedan en kort lagesrapport: aktuell version, vad som ar live (native iOS-app + OTA), och vilka nasta steg som ar mojliga. Vanta sedan pa mina instruktioner."

echo.
echo   ===========================================
echo    Claude avslutades (kod %errorlevel%).
echo    Tryck en tangent for att stanga fonstret.
echo   ===========================================
pause >nul
