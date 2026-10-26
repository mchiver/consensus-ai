; installer.nsh - electron-builder's include for the Desktop's Windows installer (plan Installer; named by nsis.include in
; build/desktop.json since plan The Server, Step 3). "Open in Consensus Desktop" in the file explorer's context menu, on a folder and on the empty space
; inside a folder, each running the app on that folder (`"Consensus Desktop.exe" <folder>`: that folder's project alone, its
; .consensus made when it has none). Written through SHCTX: the current user's classes for the per-user install the
; installer makes, the machine's if an install were ever per-machine. Windows 11 shows the entry under "Show more
; options", as it does every registry-made entry. The uninstaller removes both keys.

!macro customInstall
	WriteRegStr SHCTX "Software\Classes\Directory\shell\Consensus" "" "Open in Consensus Desktop"
	WriteRegStr SHCTX "Software\Classes\Directory\shell\Consensus" "Icon" "$INSTDIR\Consensus Desktop.exe"
	WriteRegStr SHCTX "Software\Classes\Directory\shell\Consensus\command" "" '"$INSTDIR\Consensus Desktop.exe" "%1"'
	WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\Consensus" "" "Open in Consensus Desktop"
	WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\Consensus" "Icon" "$INSTDIR\Consensus Desktop.exe"
	WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\Consensus\command" "" '"$INSTDIR\Consensus Desktop.exe" "%V"'
!macroend

!macro customUnInstall
	DeleteRegKey SHCTX "Software\Classes\Directory\shell\Consensus"
	DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\Consensus"
!macroend
