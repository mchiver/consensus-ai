# Step 5: Title and Chrome

The fifth step of plan UI Components: the Application Title and the Application Chrome, with the desktop's menu and title bar changes (items 1 and 2 of the parent).

## Application Chrome

Application window, title bar, window size and close buttons.

Decided: the desktop window uses Electron's hidden title bar with the native overlay buttons (minimize, maximize and close, drawn by Electron in the palette's colours and following the theme); the rest of the bar is a drag region filled by the Title Bar component. A browser shows the same bar as an ordinary top bar, without the window buttons and the drag region. No custom window buttons over IPC.

## Application Title

The application title (Consensus), the global application menu (including Help), and the application status (the number of threads waiting on me).

Decided: one application menu in both hosts. The desktop's native menu bar goes; its items (Servers…, Reload, New window, Open folder in new window, Quit) appear in the application menu only when the desktop is the host. The server rows' menus (New Project, Import, Settings) stay in the tree. The status shows the count of threads waiting on me and the count of LLM runs in progress, each a link to its view.

## Decided before the build

1. Two components: title-bar (the brand, the application menu button, the status, the look button; the drag region in the desktop) and look-controls (the theme, size and editor selects, in a popover the look button opens). sidebar.js and SidebarController go; the aside holds <project-tree> alone. help.js keeps HelpController for the About and Hotkeys popups; the Help menu button goes, its items move into the application menu.
2. <title-bar> is the first thing in the body, above .layout; the body is a flex column and .layout takes the rest. The bar is the same in the main window, a detached window and a browser. The popup menu, the popups and the toast stay where they are.
3. The main window and the detached windows take titleBarStyle "hidden" with titleBarOverlay: Electron draws minimize, maximize and close over the bar's right end. The bar is the drag region, its buttons and links no-drag; a double-click maximizes. The bar sits at env(titlebar-area-x) and is env(titlebar-area-width) wide, 0 and 100% the fallbacks.
4. main.js opens the window with a light or a dark pair from the settings' theme; once the page renders, and after every theme or size change, the page sends the bar's computed background, text colour and height over ConsensusDesktop.SetChrome( { Color, Symbol, Height } ), and main.js calls setTitleBarOverlay on the sender's window. The connect screen does the same from its header, which is its drag region.
5. The native menu bar is not shown (setMenuBarVisibility( false ) keeps Alt from bringing it back), but the Menu is still built and set: its accelerators keep Ctrl+R, Ctrl+N, Ctrl+Shift+O, F12 and Ctrl+Shift+I, Ctrl+0, Ctrl+= and Ctrl+-, and F11 working. The View menu's items stay keys.
6. One Menu button after the brand (id app-menu) opens the Menus popup: About, Hotkeys; when window.Desktop is there, a separator, Servers…, New window, Open folder in new window…, Reload, a separator, Quit. Open folder in new window and Quit are two new bridge calls; Reload is location.reload(). "The page" goes. The root rows' menus stay as they are.
7. The status at the bar's right: "Waiting on you: N" (id waiting-link, to #/waiting, marked open on that view), counted over every root; "Running: N" only while N > 0, counted over every root's running runs, a link to the first running run's LLM page, its tooltip naming every running connection and its server; it follows runs-changed.
8. A gear button at the far right (id look-button) opens a popover holding look-controls, the three selects with their ids (theme-select, scale-select, editor-select) and the labels Theme, Size, Editor. A click outside or Escape closes it.
9. .sidebar-top, .brand, .menu-bar, .menu-bar-item, .waiting-link, .sidebar-bottom and .theme-controls leave consensus.css for title-bar.css and look-controls.css (the bar's button is .title-button). The bar: the panel background, a bottom border, 2.25rem high at the normal size, the brand at 1.1rem. .help-form stays in consensus.css.
10. The bar shows the brand only; the window's title stays "Consensus Desktop".
11. Tests: the Help test picks from #app-menu; the editor tests open the look popover before #editor-select; the waiting-link test holds. New browser tests: the bar renders with its parts; the menu in a browser has the two items and no desktop items; the look popover opens, changes the theme, closes on Escape. One Electron smoke on a temporary config (--config, --port 0) with its own --user-data-dir: no frame, the overlay takes the palette after a theme change, the menu lists the desktop items, Open folder in new window and Quit are wired; screenshots in light and dark. The real desktop.json is not touched.
12. Out of this step: the guide's text on the Server menu and the sidebar's controls, and the desktop's keys in the Hotkeys popup (Step 6).
