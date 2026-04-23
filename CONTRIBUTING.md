# Contributing to Socket

Thanks for contributing.

These guidelines keep the local-network product direction consistent while the app evolves from its earlier sync-only form into a messaging and transfer workspace.

## How to Contribute

### Report bugs
- Use a specific title that describes the failure clearly.
- Include reproduction steps, the network setup, and what behavior you expected.
- Mention whether the issue affects discovery, messaging, access approval, transfers, or sync.

### Suggest enhancements
- Explain the user problem first, not just the feature idea.
- Describe how the change would improve the Socket workflow for local-network users.
- Call out whether the proposal affects UX, protocol behavior, storage, or packaging.

### Pull requests
- Branch from `main`.
- Update docs when public behavior or setup changes.
- Add tests when practical for the area you changed.
- Keep the UX-first product direction intact.

## Development Style

- Use present-tense, imperative commit messages.
- Prefer `const` and `let`.
- Keep renderer interactions readable and organized around workspaces rather than scattered DOM fragments.

## Local Development

1. Clone the repo.
2. Run `npm install`.
3. Run `npm run dev`.

Packaging is manual. If you need a desktop build, run it yourself when appropriate.
