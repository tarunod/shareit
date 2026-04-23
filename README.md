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

## Local Storage

- Application data: `%USERPROFILE%\\.socket`
- Synced files: `C:\\Socket`

## Notes

- The app can still interoperate with older discovery packets from the previous app name during the transition because it accepts both beacon formats.
- Existing share/sync behavior is retained, but the UI now centers around conversations and operational workspaces instead of a dashboard.
