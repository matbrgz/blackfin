#!/bin/bash

INSTALL_DIR="/usr/lib/desktop-plus"
CLI_DIR="$INSTALL_DIR/resources/app/static"
CLI_INSTALL_TARGET="/usr/bin/desktop-plus-cli"

# add executable permissions for CLI interface
chmod +x "$CLI_DIR"/desktop-plus-cli || :

# create symbolic links to /usr/bin directory
ln -f -s "$CLI_DIR"/desktop-plus-cli "$CLI_INSTALL_TARGET" || :

# https://github.com/shiftkey/desktop/issues/21
if [ ! -f /usr/lib64/libcurl-gnutls.so.4 ]; then
  find "$INSTALL_DIR" -type f -executable -exec \
    sed -i 's/libcurl-gnutls\.so\.4/libcurl.so.4\x00\x00\x00\x00\x00\x00\x00/g' {} \; 2>/dev/null || true
fi

exit 0
