// Icon is named "gh-desktop-plus" rather than "desktop-plus" to avoid the freedesktop dash-stripping fallback
// ('desktop' exists in many icon themes, so that icon would be used instead of ours).
export const LINUX_ICON_NAME = 'gh-desktop-plus'

// electron-installer-common derives the installed hicolor icon filename from the
// package name (`appIdentifier`, which is just `options.name`). Patch the given
// installer's `copyHicolorIcons` so the icons land under LINUX_ICON_NAME by
// swapping the name only for the duration of that single step; everything else
// (paths, binary, .desktop filename) keeps reading the real package name.
// Returns a function that restores the original method.
export function overrideHicolorIconName(Installer: any): () => void {
  const original = Installer.prototype.copyHicolorIcons
  Installer.prototype.copyHicolorIcons = async function (this: any) {
    const packageName = this.options.name
    this.options.name = LINUX_ICON_NAME
    try {
      return await original.call(this)
    } finally {
      this.options.name = packageName
    }
  }
  return () => {
    Installer.prototype.copyHicolorIcons = original
  }
}
