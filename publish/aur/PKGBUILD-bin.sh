# Maintainer: Pol Rivero < aur AT polrivero DOT com >
# Contributor: Padraic Fanning < fanninpm AT miamioh DOT edu >
# Contributor: Jake <aur@ja-ke.tech>
# Contributor: Ian MacKay <immackay0@gmail.com>

_pkgname='blackfin'
_old_pkgname='github-blackfin'
pkgname="${_pkgname}-bin"
pkgver=[[APP_VERSION]]
pkgrel=1
pkgdesc="GitHub Desktop fork with extra features and improvements (binary release)."
arch=('x86_64' 'aarch64')
url="https://github.com/matbrgz/blackfin"
license=('MIT')
provides=(${_pkgname} ${_old_pkgname})
conflicts=(${_pkgname} ${_old_pkgname})
replaces=("${_old_pkgname}-bin")
depends=(
    'curl'
    'libcurl-gnutls'
    'git'
    'libsecret'
    'libxss'
    'nspr'
    'nss'
    'org.freedesktop.secrets'
    'unzip'
)
optdepends=('hub: CLI interface for GitHub.')
source=(
    "${_pkgname}.desktop"
    'launch-app.sh'
)

_common_download_url="${url}/releases/download/v${pkgver}/Blackfin-v${pkgver}-linux"
source_x86_64=(${_common_download_url}-x86_64.deb)
source_aarch64=(${_common_download_url}-arm64.deb)

sha256sums=(
    '[[DESKTOP_FILE_SHA256]]'
    '[[LAUNCH_SCRIPT_SHA256]]'
)
sha256sums_x86_64=('[[X86_64_SHA256]]')
sha256sums_aarch64=('[[AARCH64_SHA256]]')
package() {
    INSTALL_DIR="$pkgdir/opt/${_pkgname}"

    tar --zstd -xf data.tar.zst -C "$pkgdir"
    install -d "$INSTALL_DIR"

    mv "$pkgdir/usr/lib/blackfin/"* "$INSTALL_DIR/"
    rmdir "$pkgdir/usr/lib/blackfin"
    rmdir "$pkgdir/usr/lib"

    rm "$pkgdir/usr/share/applications/blackfin.desktop"
    install -Dm644 "${_pkgname}.desktop" "$pkgdir/usr/share/applications/${_pkgname}.desktop"

    install -Dm755 "$srcdir/launch-app.sh" "$pkgdir/usr/bin/${_pkgname}"

    chmod +x "$INSTALL_DIR/resources/app/static/blackfin-cli"
    ln -s "/opt/${_pkgname}/resources/app/static/blackfin-cli" "$pkgdir/usr/bin/blackfin-cli"
}
