Desktop Plus v3.6.3

Upstream: [GitHub Desktop 3.6.3 release notes](https://github.com/desktop/desktop/releases/tag/release-3.6.3)

---

## **Changes and improvements:**

- [#178] We now support **Codeberg** accounts in Desktop Plus! Thank you @fl-f for your contribution!  
  You can now sign in using your Codeberg account and:
  - Clone repositories from within the app.
  - Preview and create pull requests.
  - View pull request status, including checks.
  - Enjoy other minor UI improvements that make your experience with Codeberg better.

- All OAuth providers (GitHub, Bitbucket, GitLab, and Codeberg) now use PKCE (Proof Key for Code Exchange) for improved security. You shouldn't notice any difference in your sign-in experience, but if you encounter any problems, please [open an issue](https://github.com/desktop-plus/desktop-plus/issues/new/choose).

## Fixes:

- [#213] Handle autosquash prefixes properly when rendering conventional commit badges.

- [#215] Avoid showing the developer tools panel when quickly hovering over PRs in the PR list.

- The native title bar now shows the correct Desktop Plus logo instead of the upstream (GitHub Desktop) logo.
