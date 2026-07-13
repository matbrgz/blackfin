<h1 align="center">Blackfin</h1>

<p align="center"><strong>The Agentic Control Center for Developers.</strong></p>

<p align="center">
A desktop git client for people who ship code they didn't type.
</p>

---

> [!WARNING]
> **Blackfin is pre-release and under active development.** The agentic features
> described below are specified and being built — they do not ship yet. What works
> today is everything inherited from [GH Desktop Plus](https://github.com/desktop-plus/desktop-plus),
> which is a mature, up-to-date fork of [GitHub Desktop](https://desktop.github.com).
> See [Status](#status) for exactly what is and isn't done.

> [!IMPORTANT]
> This is a community-maintained project. It **is not** an official GitHub product.

## The problem

You don't write most of your code anymore. An agent does.

And every tool in your stack still assumes you typed every line. Your git client shows
you an 800-line diff with no idea that 600 of those lines came out of a model at 2am.
The `CLAUDE.md` steering that agent has a broken `@import` and nobody has noticed for
three weeks. You have four agents running on four branches and the only way to know
what any of them did is to open four terminals.

The agent became a first-class actor in your repository. Your tools didn't notice.

## What Blackfin does about it

Blackfin is a git client that knows the agent is there.

**It reads the context you give your agents.** Every `CLAUDE.md`, `AGENTS.md`, Cursor
rule, and Copilot instruction across every project you have — indexed, structured, and
reported in one place. Which projects have none. Which files reference documents that
no longer exist. What each one actually tells the agent to do.

**It knows which lines the agent wrote.** Attribution recorded per line range and
marked in the diff gutter, so reviewing an agent's 800-line diff means reviewing the
600 lines it actually authored — and flipping back to human the moment you edit them.
Local to Blackfin. Never committed.

**It closes the review loop.** Comment on the agent's diff the way you'd comment on a
colleague's PR — markdown, anchored to lines, following the code as it shifts. Then
send every unresolved comment back to the agent as one batched prompt. One concentrated
revision, not a dozen rounds of the agent swinging back and forth.

**It runs a fleet.** Worktrees as first-class citizens — created from a task, tracked
on a board, each one carrying a one-line checkpoint the agent writes itself. Because
the sidebar should be the fleet dashboard, not a list of folders.

**It starts from the work.** GitHub Projects, Issues, Linear, and Jira, in the app.
Start a branch from a card and the link is kept. Move the card and the tracker knows.

## Status

Blackfin is a real product being built in the open, not a landing page.

| | |
| --- | --- |
| ✅ **Ships today** | Everything from GH Desktop Plus — [see the feature list](#inherited-from-gh-desktop-plus) |
| 📐 **Specified** | [Agent Context](docs/superpowers/specs/2026-07-12-blackfin-agent-context-design.md) · Tasks · Worktrees + Fleet Board · AI Attribution · Diff Annotations |
| 🗺️ **Planned** | Project Overview · self-describing `blackfin` CLI · the rebrand itself |

Specs and their issue-sized task breakdowns live in
[`docs/superpowers/specs/`](docs/superpowers/specs/README.md). Start there if you want
to understand where this is going or contribute to it.

### What Blackfin is not

[Orca](https://github.com/stablyai/orca) is the strongest tool in this category, and
it is an **ADE** — an Agent Development Environment. It embeds terminals, an editor,
and a full browser, and runs fleets of agents inside itself.

Blackfin is deliberately not that. Bolting a terminal multiplexer, a Monaco editor,
and Chromium onto a git client isn't an enhancement — it's a rewrite, and it would
arrive second. Our asset is the inverse: **this is already an excellent desktop git
client.** The diff viewer, the partial staging, the history, the branch and PR flows
are mature and trusted.

So Blackfin is the control center *where the git already is*. Every feature above
grafts onto a surface the app already owns.

## Inherited from GH Desktop Plus

Blackfin is a fork of [GH Desktop Plus](https://github.com/desktop-plus/desktop-plus),
which is itself an up-to-date fork of GitHub Desktop. All of the following works today
and is Pol Rivero's work, not ours.

| <h4>Search commits by title, message, tag, or hash</h4> | <h4>Add multiple GitHub, Bitbucket & GitLab accounts</h4> |
| :---: | :---: |
| ![Commit search](docs/assets/blackfin-demo-search.webp) | ![Multiple accounts](docs/assets/blackfin-demo-multiaccount.webp) |
| <h4>Create multiple stashes per branch</h4> | <h4>Visualize the Commit Graph</h4> |
| ![Multiple stashes](docs/assets/blackfin-demo-stashes.webp) | ![Commit Graph](docs/assets/blackfin-demo-commit-graph.webp) |

<details>
<summary><strong>Full feature list</strong> (click to expand)</summary>

### General

- Support for **multiple accounts** of the same endpoint (e.g., multiple GitHub accounts).
  Simply add as many accounts as you want in the "Accounts" settings page. If a repository is using an incorrect account, you can change it in the repository settings.

- Support for **multiple windows**: open multiple repositories in separate windows, or the same repository in multiple windows (e.g., to view different files at the same time).
  Select "File" > "Open new window" or press `Ctrl+Alt+N`/`Cmd+Alt+N`. You can also right-click on a repository in the list and select "Open repository in new window".

- **Bitbucket** and **GitLab** integration:
  - Clone repositories from within the app.
  - Preview and create pull requests.
  - View pull request status, including checks.
  - Display a commit or PR in Bitbucket/GitLab (web browser).
  - Correctly set repository owner (instead of displaying "Other").

  The integration is enabled automatically for the corresponding repositories if you are logged in to your account.

- Allow using a **different text editor for a given repo**, by overriding it in the repository settings.

- Allow displaying **SVG files as an image** preview in the diff view.

- Some similar-looking buttons now have distinct **icons** for faster visual recognition.

- Buttons with destructive actions have a red background to make them more visually distinct.

- Allow generating **branch name presets** by calling an external script (e.g., fetching ticket numbers from an issue tracker).
  [Click here for more details](docs/branch-name-presets.md).

- Allow showing the effective **Git name and email** used for commits more prominently above the commit message input.

- Fully disables all the GitHub/Microsoft telemetry from the app.

### Repositories list

- "**Pull all**" button to fetch and pull all your repositories at once.

- Allow showing the **current branch name** next to the repository name.

- Allow **hiding** the "Recent" repositories section.

- Allow customizing the **repository groups** to better organize your repositories.
  Right-click on a repository and select "Change group name".

- Allow **pinning** repositories to the top of the list.

### Branches list

- Added a warning indicator to **local-only branches** (branches that have not been pushed to the remote, or that have been deleted automatically after a PR).

- Allow manually setting which is the **default branch** for a repository (even if it doesn't match the one configured in the remote).
  Right-click on a branch and select "Set as default branch". The default branch is used as the base when creating new branches.

- Allow changing the **sort order** of the branch list to either "Recently updated" or "Alphabetical".

### History tab

- **Search commits** by title, message, tag, or hash.

- Allow switching to a **Commit Graph** view to visualize the merge history.

- Use a different font style for **merge commits** in order to make them visually distinct, since most of the time they are not as relevant.

- Allow choosing between relative dates ("3 days ago") or absolute dates ("Mar 14, 2026, 2:34 PM") for displaying commit dates.

- If a commit modifies only 1 file, allow double-clicking the commit to open the file. For other commits, you can still double-click the file as usual.

- Allow deleting commits and tags that have already been pushed. Please note that this is intended for advanced users only, and can cause problems if the commits have already been pulled by other collaborators.

### Changes tab

- Added the option to **permanently discard changes** without sending to trash. This is useful when there are many changed files and the regular "Discard" is extremely slow.

---

<img src="docs/assets/blackfin-demo.webp" alt="Demo" style="max-width:1000px;">

</details>

## Installation

> [!NOTE]
> **There are no packaged Blackfin releases yet.** Packaging, bundle identifiers, and
> auto-update are the last phase of the roadmap — deliberately, so that broken builds
> during feature work don't get confused with rebrand fallout.
>
> Today you have two options: [build from source](#running-the-app-locally) to get
> Blackfin, or install upstream **GH Desktop Plus** below to get everything in the
> [inherited feature list](#inherited-from-gh-desktop-plus) without the agentic work.

<details>
<summary><strong>Install upstream GH Desktop Plus</strong> (click to expand)</summary>

These install Pol Rivero's Desktop Plus, not Blackfin.

**Windows** — `winget install polrivero.GitHubDesktopPlus`

**macOS** — `brew install desktop-plus/tap/desktop-plus`

**Debian / Ubuntu / Mint / Pop!_OS / Zorin (APT)**

```bash
sudo curl https://gpg.desktop-plus.org/public.key | sudo gpg --dearmor -o /usr/share/keyrings/desktop-plus.gpg
echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/desktop-plus.gpg] https://apt.desktop-plus.org/ stable main" | sudo tee /etc/apt/sources.list.d/desktop-plus.list
sudo apt update && sudo apt install desktop-plus
```

**Fedora / RHEL / CentOS (RPM)**

```bash
sudo rpm --import https://gpg.desktop-plus.org/public.key
echo -e "[desktop-plus]\nname=Desktop Plus\nbaseurl=https://rpm.desktop-plus.org/\nenabled=1\ngpgcheck=1\nrepo_gpgcheck=1\ngpgkey=https://gpg.desktop-plus.org/public.key" | sudo tee /etc/yum.repos.d/desktop-plus.repo
sudo dnf check-update --refresh && sudo dnf install desktop-plus
```

**OpenSUSE (RPM)**

```bash
sudo rpm --import https://gpg.desktop-plus.org/public.key
echo -e "[desktop-plus]\nname=Desktop Plus\nbaseurl=https://rpm.desktop-plus.org/\nenabled=1\ngpgcheck=1\nrepo_gpgcheck=1\ngpgkey=https://gpg.desktop-plus.org/public.key" | sudo tee /etc/zypp/repos.d/desktop-plus.repo
sudo zypper refresh && sudo zypper install desktop-plus
```

**Arch / Manjaro (AUR)** — `yay -S desktop-plus-bin`

> `gnome-keyring` is required and the daemon must be launched either at login or when the X server / Wayland compositor is started. See the [Arch Wiki](https://wiki.archlinux.org/index.php/GNOME/Keyring#Using_the_keyring_outside_GNOME) if credentials aren't saved.

**Flatpak (any distro)** — `flatpak install flathub org.desktop_plus.desktop-plus`

> Git hooks run inside the Flatpak sandbox and cannot access programs installed on your system (version managers, linters, etc.). If your hooks depend on those, install a native package instead.

Direct downloads for all platforms are on the [Desktop Plus releases page](https://github.com/desktop-plus/desktop-plus/releases/latest).

</details>

## Running the app locally

```bash
corepack enable  # Install yarn if needed
yarn             # Install dependencies
yarn build:dev   # Initial build
yarn start       # Start the app for development and watch for changes
```

- It's normal for the app to take a while to start up, especially the first time.
- While starting up, this error is normal: `UnhandledPromiseRejectionWarning: Error: Invalid header: Does not start with Cr24`
- You don't need to restart the app to apply changes. Just reload the window (`Ctrl + Alt + R` / `Cmd + Alt + R`).
- Changes to the code inside `main-process` **do** require a full rebuild. Stop the app and run `yarn build:dev` again.
- [Read this document](docs/contributing/setup.md) for more on setting up your development environment.

From VSCode: run `corepack enable && yarn`, then press `F5`. Set breakpoints in the developer tools, not the VSCode editor.

### Running tests

Run them in Docker for reproducibility and to avoid conflicts with your git configuration:

```bash
yarn test:docker
```

## Contributing

Blackfin is built spec-first. Every feature starts as a design document in
[`docs/superpowers/specs/`](docs/superpowers/specs/README.md), gets broken into
issue-sized tasks with acceptance criteria, and is implemented on its own branch.

If you want to help, read the [spec index](docs/superpowers/specs/README.md) and pick
up an open issue. If you want to propose something, open an issue describing the
problem before the solution.

## Common issues

Check the [Known Issues](docs/known-issues.md) document before opening a new issue.

## Credits

Blackfin stands on two pieces of other people's work, and would not exist without either:

- [**GitHub Desktop**](https://github.com/desktop/desktop) by GitHub — the foundation.
- [**GH Desktop Plus**](https://github.com/desktop-plus/desktop-plus) by
  [Pol Rivero](https://github.com/pol-rivero) — the fork that keeps it alive on Linux,
  adds multi-account support, Bitbucket and GitLab integration, the commit graph, and
  much of what makes this app worth building on. Blackfin tracks it upstream.

[Orca](https://github.com/stablyai/orca) by Stably AI shaped a lot of the thinking here,
particularly on diff annotation batching, AI attribution, and worktrees as the unit of
agentic work. Different product, excellent ideas, credit where it's due.

Application icon adapted from [`git-branch-plus`](https://lucide.dev/icons/git-branch-plus)
by [Lucide](https://lucide.dev), [ISC license](https://github.com/lucide-icons/lucide/blob/main/LICENSE).

## License

MIT. See [LICENSE](LICENSE).
