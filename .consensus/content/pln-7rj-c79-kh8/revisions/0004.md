# Installer

A Windows installer for Consensus Desktop, built with electron-builder from the repository root. The build exists since 2026-10-14; this plan records what it produces and what remains before it can be handed to someone else.

## What is built

- `npm run dist` runs `electron-builder --win nsis` from the root; the configuration is the `build` block of the root package.json, so the server, the public page and the production dependencies ride along with the desktop.
    - The root `main` stays the server (src/Server.js); the builder's `extraMetadata.main` names desktop/main.js as the app's entry, so the npm package and the CLI are unchanged.
    - The app archive (resources/app.asar) holds `desktop`, `src`, `public`, `.guides/build-with-consensus.md` (the server reads it for /instructions) and package.json, plus the production `node_modules`. Dev dependencies, `bin`, `docs`, `test`, the dot folders and the tilde folders stay out.
    - The vendor files (angular, bootstrap, marked) are served from where `require` resolves them, which works inside the archive.
- Output goes to `~dist` (excluded from source control by the tilde rule):
    - `Consensus Setup <version>.exe`: the NSIS installer, about 121 MB; not one-click, the install folder can be chosen, per-user install.
    - `win-unpacked/`: the installed layout, runnable as is for a smoke.
    - `latest.yml` and the `.blockmap`: what electron-updater would read; unused for now.
- The version on the installer is the root package.json version.
- The installed app behaves as the checkout's `npm run desktop`: it reads `<user>/.consensus/consensus.json`, starts its own server from it on port 3500, and keeps its settings there. The app archive is read only, so nothing may be written next to the code; nothing is today.
- desktop/main.js's "new window" spawn passes the app folder only from the checkout: installed, the executable is the app, and the folder would have been read as a project argument.
- Smoked on 2026-10-14: the unpacked executable launched on a temporary config and user-data folder with `--port 0`, showed the Consensus page with Angular loaded, served the vendor files and the stylesheet from the archive, and created a fresh config and projects folder.

## What needs to be done

- Icon. Built 2026-10-14. The build no longer warns, and the installer, the executable and the taskbar show the Consensus mark.
    - The brand already existed: the docs' mark, `docs/images/mark.svg`, a ring open at the top right with a check inside, stroked in the page's accent color (#0d6efd) on a transparent ground, no text. It is the one branding image; the speech bubbles proposed earlier are dropped. The master is `public/img/mark.svg`, the same drawing, served by the web server and the desktop; the docs keep their copy because the docs folder is published as it is.
    - Derived from the master with ImageMagick (on the build machine; the project takes no image dependency) and committed: `desktop/icon.ico` with 16, 32, 48, 64, 128 and 256 pixels in one file, named in the `win.icon` setting, and `desktop/icon.png` at 512 pixels for a later Linux build. electron-builder makes the installer's and uninstaller's icons from the `.ico`. To render again, each size from the vector so the small ones are crisp:
        - `magick -background none -density <size * 96 / 64> public/img/mark.svg -resize <size>x<size> -depth 8 mark-<size>.png`
        - `magick mark-16.png mark-32.png mark-48.png mark-64.png mark-128.png mark-256.png desktop/icon.ico`
    - No `.icns` yet: this ImageMagick cannot write one; it is made from the same renders when the Mac build comes.
    - The web page links the SVG as its favicon (`<link rel="icon" href="/img/mark.svg">`, in place of the empty data URL) and the About popup shows the mark before its title (`.about-mark` in consensus.css). The docs already link theirs.
    - Checked: the icon extracted from the built `Consensus.exe` and from `Consensus Setup 0.4.0.exe` is the mark; the running server serves `/img/mark.svg` and the page with the favicon; the test suite passes.
- Signing. The build calls signtool with no certificate, so the installer is unsigned: Windows SmartScreen warns on first run ("Windows protected your PC") until the publisher is known. A publicly trusted code-signing certificate is needed, and since 2023 the CA/Browser Forum rules require its private key to live in hardware or a cloud key service, never in a file.
    - AWS and Azure compared for this, as of 2026-10-14:
        - AWS has no service that issues publicly trusted code-signing certificates. Certificate Manager issues TLS certificates only; Private CA issues certificates that Windows does not trust; AWS Signer's Windows platform signs with Private CA or imported certificates, and the CAs no longer hand out keys to import. AWS can only hold the key: an RSA key in KMS (about $1 a month and fractions of a cent per signature), with the certificate bought from a CA that accepts a KMS key attestation (SSL.com, FairSSL, GlobalSign, DigiCert through a reseller), at $200 to $400 a year for OV and $300 to $600 for EV. Signing is then done with Jsign (a Java tool that talks to KMS), since signtool cannot use a KMS key; electron-builder has no KMS backend and would call Jsign through its custom sign hook. Total: a certificate's price plus a build tool of its own, and the key management is ours.
        - Azure Trusted Signing (renamed Azure Artifact Signing in 2026) is Microsoft acting as the CA: the key is Microsoft's, the certificate is short lived and renewed by the service, and the publisher identity is validated once. Basic tier $9.99 a month for 5,000 signatures (about $120 a year), Premium $99.99. Individuals can validate in the US and Canada; organizations in the US, Canada, the EU and the UK. electron-builder signs with it natively through `win.azureSignOptions` (endpoint, account name, certificate profile name, publisher name), authenticated by an Entra app registration whose tenant id, client id and client secret go into the environment, never the repository. Reports from 2025 note friction: the role assignment step and the identity validation wait took people hours to days.
        - SmartScreen is the same for both: reputation accrues as signed installs are seen, and Microsoft stopped giving EV certificates instant reputation in 2024, so EV no longer buys a shortcut.
    - Decided: Azure Trusted Signing. AWS being the primary cloud does not help here, since AWS cannot issue the certificate; the Azure footprint is one subscription with one signing account, and nothing else moves. It is the cheapest path, needs no key custody of ours, and electron-builder supports it without extra tooling. Mac notarization, when it comes, is Apple's own service in the same way.
    - Steps: an Azure subscription and a Trusted Signing account in a region of the user's choice; identity validation as an individual (US) or as the organization; a certificate profile of the Public Trust kind; an app registration with the "Trusted Signing Certificate Profile Signer" role; the four values into the `win.azureSignOptions` block of package.json; the three credentials into the environment of the machine that runs `npm run dist`. The signed installer is then checked on a clean machine for the publisher name on the SmartScreen prompt.
- Out of scope for this plan, noted for later:
    - Auto update with electron-updater over GitHub Releases: the build already writes `latest.yml` and the blockmap; it needs a `publish` setting, a release workflow and the signing above, since an unsigned update is refused.
    - Mac (`.dmg`, needs notarization) and Linux (AppImage, `.deb`) targets: the same config with `mac` and `linux` blocks, built on each platform.
    - A `README` note on where the installer is downloaded from and that the installed app runs its own server on port 3500.
