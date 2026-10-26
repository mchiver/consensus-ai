; server-installer.nsh - electron-builder's include for the Server's Windows installer (plan The Server, Step 3; named
; by nsis.include in build/server.json). "Open in Consensus Server" in the file explorer's context menu, on a folder
; and on the empty space inside a folder, each running the Server with --open on that folder: the folder registered as
; a project of the Server (or found when it is registered already) and shown in its window; a Server already running
; takes it over. Written through SHCTX, as the Desktop's installer.nsh; the uninstaller removes both keys.

!macro customInstall
	WriteRegStr SHCTX "Software\Classes\Directory\shell\ConsensusServer" "" "Open in Consensus Server"
	WriteRegStr SHCTX "Software\Classes\Directory\shell\ConsensusServer" "Icon" "$INSTDIR\Consensus Server.exe"
	WriteRegStr SHCTX "Software\Classes\Directory\shell\ConsensusServer\command" "" '"$INSTDIR\Consensus Server.exe" --open "%1"'
	WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\ConsensusServer" "" "Open in Consensus Server"
	WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\ConsensusServer" "Icon" "$INSTDIR\Consensus Server.exe"
	WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\ConsensusServer\command" "" '"$INSTDIR\Consensus Server.exe" --open "%V"'
!macroend

!macro customUnInstall
	DeleteRegKey SHCTX "Software\Classes\Directory\shell\ConsensusServer"
	DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\ConsensusServer"
!macroend
