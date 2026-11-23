; Hooks for the Tauri NSIS installer (bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; Up to 1.0.1 KeyCat for Windows was an Electron app in %LOCALAPPDATA%\Programs\KeyCat. Its
; updater downloads this installer like any other release, so here the old copy is removed and
; its settings and start-at-login choice move over; otherwise two cats would run side by side.
; Its updater passes --force-run when the app should start again afterwards.

Var MigratedFromElectron

!macro NSIS_HOOK_PREINSTALL
  StrCpy $R8 "$LOCALAPPDATA\Programs\KeyCat"
  ${If} ${FileExists} "$R8\Uninstall KeyCat.exe"
    DetailPrint "Removing KeyCat 1.0 (Electron)"
    StrCpy $MigratedFromElectron 1
    nsExec::Exec 'taskkill /f /im KeyCat.exe'
    Pop $R9
    ExecWait '"$R8\Uninstall KeyCat.exe" /S _?=$R8'
    Delete "$R8\Uninstall KeyCat.exe"
    RMDir "$R8"
  ${EndIf}

  ; Electron registered start at login under its AppUserModelId; the new build uses the product name.
  ReadRegStr $R9 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.ellobok.keycat"
  ${If} $R9 != ""
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.ellobok.keycat"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "KeyCat" '"$INSTDIR\KeyCat.exe"'
  ${EndIf}

  ; "Local State" marks the folder as Electron's profile; only settings.json is worth keeping.
  ${If} ${FileExists} "$APPDATA\KeyCat\Local State"
    ${IfNot} ${FileExists} "$APPDATA\com.ellobok.keycat\settings.json"
    ${AndIf} ${FileExists} "$APPDATA\KeyCat\settings.json"
      CreateDirectory "$APPDATA\com.ellobok.keycat"
      CopyFiles /SILENT "$APPDATA\KeyCat\settings.json" "$APPDATA\com.ellobok.keycat"
    ${EndIf}
    RMDir /r "$APPDATA\KeyCat"
  ${EndIf}
  RMDir /r "$LOCALAPPDATA\keycat-win-updater"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $MigratedFromElectron = 1
    ClearErrors
    ${GetOptions} $CMDLINE "--force-run" $R9
    ${IfNot} ${Errors}
      nsis_tauri_utils::RunAsUser "$INSTDIR\KeyCat.exe" ""
    ${EndIf}
  ${EndIf}
!macroend
