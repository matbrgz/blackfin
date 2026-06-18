GitHub Desktop Plus v3.5.13-beta1

Upstream: [GitHub Desktop 3.5.13-beta1 release notes](https://github.com/desktop/desktop/releases/tag/release-3.5.13-beta1)

> [!NOTE]
> This release removes our fork-specific implementation of Git Worktrees integration in favor of the new upstream implementation.  
> Some worktree-related features may now work slightly differently than before.  

> [!WARNING]
> If you had repositories with worktrees before this release, those repositories may now appear as duplicates in your repository list. If you encounter this issue, you can simply remove the duplicates from the app.  
> Make sure **NOT** to check the "Also move this repository to Trash" checkbox when removing the duplicates.

---

## **Changes and improvements:**

- [#174] Added new **"Open worktree in new window"** context menu option when right-clicking on a worktree.

- [#158] [#159] [#160] [#165] Improved the Git Worktrees UX by switching to the new upstream implementation.

- Added new **"Delete unused local branches"** context menu option. This option shows up when right-clicking on a local-only branch, only if the repository has 3 or more local-only branches.  
  This will delete *all* local-only branches that are not currently checked out. Use it with caution!

## **Fixes:**

- Building the app no longer hangs indefinitely when using Node.js 24.16.0 or some Node.js 26 versions. Ref: [nodejs/node#63487](https://github.com/nodejs/node/issues/63487)  
  This mainly affects Arch Linux users installing `github-desktop-plus` or `github-desktop-plus-git` from the AUR.
