# Socket

Socket is a local-network messaging and transfer workspace built with Electron. It is designed for people on the same LAN or WiFi who want direct messages, file handoff, access approvals, and background sync without relying on cloud infrastructure.

## What Socket Does

- Discovers peers automatically on the same local network
- Opens direct-message threads with those peers
- Sends files and folders from the active thread interface
- Keeps accepted items syncing into a local master folder
- Surfaces access requests, transfer state, and sync progress in dedicated workspaces

## Current Product Shape

Socket is intentionally local-first:

- Direct messages are peer-to-peer only in v1
- Message history is stored locally on each device
- UDP discovery is used for presence
- Socket.IO is used for real-time messaging and transfer coordination
- File sync continues to run in the background after access is accepted

## App Structure

- `renderer/` contains the desktop UI shell and interactions
- `src/main.js` bootstraps the Electron app and IPC layer
- `src/discovery.js` handles LAN presence and peer socket connections
- `src/server.js` receives direct messages, access requests, and transfer events
- `src/sync.js` performs background synchronization for accepted items
- `src/store.js` persists local user, conversation, inbox, and transfer state

## Development

### Prerequisites

- Node.js 18+
- npm

### Install dependencies

```bash
npm install
```

### Run

```bash
npm run dev
```

### Package

```bash
npm run build
```

Build and packaging are not run automatically in this repo. Run them manually when you want to verify desktop packaging.

## App Update Release Flow

Socket updates are delivered through GitHub Releases using `electron-updater`.

1. Push code changes.
2. Set GitHub token in shell:
   - PowerShell: `$env:GH_TOKEN="your_token"`
3. Run release publish:
   - `npm run dist`
4. `predist` now validates release config/token and auto-bumps app version before publish.
5. A GitHub Release with update artifacts is published.
6. Client apps detect the new version using Settings `Check now` or periodic auto-check.
7. If auto-download is enabled, the update downloads automatically; otherwise users can click `Download update`.
8. When status becomes ready, users click `Install update` (or install on app quit).

If users skip a version, they can clear the skipped version from Settings.

### Versioning Automation

- `npm run build` auto-bumps app version before packaging.
- `npm run dist` auto-bumps app version before publish.
- Dry-run preview of next version:
  - `npm run version:bump:dry`
- Manual bump helper:
  - `npm run version:bump`
- Optional bump type override:
  - `BUMP_PART=minor npm run version:bump`
  - `BUMP_PART=major npm run version:bump`

## Local Storage

- Application data: `%USERPROFILE%\\.socket`
- Synced files: `C:\\Socket`

## Notes

- The app can still interoperate with older discovery packets from the previous app name during the transition because it accepts both beacon formats.
- Existing share/sync behavior is retained, but the UI now centers around conversations and operational workspaces instead of a dashboard.
