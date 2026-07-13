#!/bin/bash

set -e

PROFILE_D_FILE="/etc/profile.d/blackfin.sh"
INSTALL_DIR="/usr/lib/blackfin"
CLI_DIR="$INSTALL_DIR/resources/app/static"
CLI_INSTALL_TARGET="/usr/bin/blackfin-cli"

case "$1" in
    configure)
      # add executable permissions for CLI interface
      chmod +x "$CLI_DIR"/blackfin-cli || :
      # check if this is a dev install or standard
      if [ -f "$INSTALL_DIR/blackfin-dev" ]; then
	      BINARY_NAME="blackfin-dev"
      else
	      BINARY_NAME="blackfin"
      fi
      # create symbolic links to /usr/bin directory
      ln -f -s "$INSTALL_DIR"/$BINARY_NAME /usr/bin || :
      ln -f -s "$CLI_DIR"/blackfin-cli "$CLI_INSTALL_TARGET" || :
    ;;

    abort-upgrade|abort-remove|abort-deconfigure)
    ;;

    *)
      echo "postinst called with unknown argument \`$1'" >&2
      exit 1
    ;;
esac

exit 0
