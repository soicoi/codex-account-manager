# Manager UI

This repository now includes a local desktop account manager under `manager/`.

## Goal

The manager is meant to be the fastest path from the current `codex-auth` CLI to a richer account manager with:

- an Electron desktop window
- a compact dashboard and accounts table
- quota-aware account switching
- quick capture of the current `~/.codex/auth.json` session
- background feature toggles for usage API and auto-switch

The backend is intentionally implemented with Node core modules only so it can run in environments where the Zig and Rust toolchains are not installed.

## Start

```powershell
npm.cmd install
npm.cmd run manager:start
```

This opens the Electron desktop app.

If you want the browser fallback for debugging, run:

```powershell
npm.cmd run manager:web
```

Then open `http://127.0.0.1:4286`.

## Design Notes

- Read-only state comes directly from `~/.codex/accounts/registry.json`.
- Quota refresh and config toggles call the published `codex-auth` binary through the local npm package.
- Account switching is handled in the manager core so the UI can switch by `account_key`, which is more reliable than email/alias matching when multiple snapshots share one email.
- Quick capture imports the current `~/.codex/auth.json` with `codex-auth import` and then runs `list` once to sync active-account metadata.
- Electron talks to the manager core through `preload.js` and `ipcMain`, so the renderer does not need direct Node access.

## Next Steps

The current app is a bridge layer, not the final architecture. Likely next upgrades:

1. Add file upload and batch import flows for auth snapshots and CPA exports.
2. Add an embedded login helper that watches `auth.json` changes and auto-captures new sessions.
3. Package installers for Windows instead of running from source only.
4. Move the switch/capture logic into a shared backend library if the Zig core later exposes a machine-readable interface.
