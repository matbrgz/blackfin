#!/bin/bash

CLI_BINARY="/usr/bin/desktop-plus-cli"

# remove symbolic links in /usr/bin directory
test -f ${CLI_BINARY} && unlink ${CLI_BINARY}

exit 0
