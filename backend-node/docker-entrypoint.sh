#!/bin/sh
# Keep this file LF-terminated because Docker executes the shebang directly.
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R node:node /app/data
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
