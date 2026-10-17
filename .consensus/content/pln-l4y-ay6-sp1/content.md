# Step 5: Title and Chrome

The fifth step of plan UI Components: the Application Title and the Application Chrome, with the desktop's menu and title bar changes (items 1 and 2 of the parent).

## Application Chrome

Application window, title bar, window size and close buttons.

Decided: the desktop window uses Electron's hidden title bar with the native overlay buttons (minimize, maximize and close, drawn by Electron in the palette's colours and following the theme); the rest of the bar is a drag region filled by the Title Bar component. A browser shows the same bar as an ordinary top bar, without the window buttons and the drag region. No custom window buttons over IPC.

## Application Title

The application title (Consensus), the global application menu (including Help), and the application status (the number of threads waiting on me).

Decided: one application menu in both hosts. The desktop's native menu bar goes; its items (Servers…, Reload, New window, Open folder in new window, Quit) appear in the application menu only when the desktop is the host. The server rows' menus (New Project, Import, Settings) stay in the tree. The status shows the count of threads waiting on me and the count of LLM runs in progress, each a link to its view.
