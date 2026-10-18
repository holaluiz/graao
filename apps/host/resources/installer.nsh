; Graao Host installer additions (electron-builder registers URL protocols only on macOS).
; The graao-host:// link lets the graao site wake this app; it is removed again by the uninstaller.
!macro customInstall
  WriteRegStr SHCTX "Software\Classes\graao-host" "" "URL:Graao Host"
  WriteRegStr SHCTX "Software\Classes\graao-host" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\graao-host\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\graao-host\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\graao-host"
!macroend
