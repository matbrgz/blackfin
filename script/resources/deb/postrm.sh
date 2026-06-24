#!/bin/bash
set -e

PROFILE_D_FILE="/etc/profile.d/desktop-plus.sh"
APP_BINARY="/usr/bin/desktop-plus"
CLI_BINARY="/usr/bin/desktop-plus-cli"

case "$1" in
    purge|remove|upgrade|failed-upgrade|abort-install|abort-upgrade|disappear)
      echo "#!/bin/sh" > "${PROFILE_D_FILE}";
      . "${PROFILE_D_FILE}";
      rm "${PROFILE_D_FILE}";
      # remove symbolic links in /usr/bin directory
      test -f ${APP_BINARY} && unlink ${APP_BINARY}
      test -f ${APP_BINARY}-dev && unlink ${APP_BINARY}-dev
      test -f ${CLI_BINARY} && unlink ${CLI_BINARY}
    ;;

    *)
      echo "postrm called with unknown argument \`$1'" >&2
      exit 1
    ;;
esac

exit 0
