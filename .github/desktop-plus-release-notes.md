Desktop Plus v3.6.2

Upstream:
- [GitHub Desktop 3.6.2-beta1 release notes](https://github.com/desktop/desktop/releases/tag/release-3.6.2-beta1)
- [GitHub Desktop 3.6.2 release notes](https://github.com/desktop/desktop/releases/tag/release-3.6.2)

---

## **Changes and improvements:**

- [#197] The "Reset to commit..." context menu item is now available for all commits, not just local-only (unpushed) commits.  
  Use it with caution! If you rewrite history on commits that other people have already pulled, you may cause problems for them.

- [#199] **Linux:** Use the OS's trust store (in addition to Chromium's) to validate certificates. This should help with some corporate environments that use self-signed certificates.

## Fixes:

- [#205] **Windows, macOS:** Fixed a missing logo in the app's About dialog.

- Made the app icon slightly bigger to make its apparent size more similar to other icons.

- **macOS:** The app should now display the correct icon (new Desktop Plus logo).

- When using the [Branch name presets](https://github.com/desktop-plus/desktop-plus/blob/main/docs/branch-name-presets.md) feature, pressing `Ctrl+1`, `Ctrl+2`, etc. to quick-select a preset now works once again.
