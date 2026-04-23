GitHub Desktop Plus v3.5.9-beta1

Upstream: [GitHub Desktop 3.5.9-beta1 release notes](https://github.com/desktop/desktop/releases/tag/release-3.5.9-beta1)

- The upstream now supports absolute date formats, so we have removed our fork-specific patch for that.  
  You can find the new date format settings in `File` > `Options` > `Appearance`, including the option "Prefer absolute dates over relative".

---

## **Fixes:**

- [#119] **Windows:** Fetching a repository will no longer hang indefinitely in some situations.

- [#143] **Linux:** Fix arm64 binary by rebuilding x86_64 native dependencies.

- [#139] Fixed missing padding in the text of some buttons.

- Performing a merge with conflicts in a linked worktree now displays the conflicts dialog correctly.
