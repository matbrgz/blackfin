#!/bin/bash

set -e

PROFILE_D_FILE="/etc/profile.d/desktop-plus.sh"
INSTALL_DIR="/usr/lib/desktop-plus"
CLI_DIR="$INSTALL_DIR/resources/app/static"
CLI_INSTALL_TARGET="/usr/bin/desktop-plus-cli"

case "$1" in
    configure)
      # add executable permissions for CLI interface
      chmod +x "$CLI_DIR"/desktop-plus-cli || :
      # check if this is a dev install or standard
      if [ -f "$INSTALL_DIR/desktop-plus-dev" ]; then
	      BINARY_NAME="desktop-plus-dev"
      else
	      BINARY_NAME="desktop-plus"
      fi
      # create symbolic links to /usr/bin directory
      ln -f -s "$INSTALL_DIR"/$BINARY_NAME /usr/bin || :
      ln -f -s "$CLI_DIR"/desktop-plus-cli "$CLI_INSTALL_TARGET" || :
    ;;

    abort-upgrade|abort-remove|abort-deconfigure)
    ;;

    *)
      echo "postinst called with unknown argument \`$1'" >&2
      exit 1
    ;;
esac

exit 0
