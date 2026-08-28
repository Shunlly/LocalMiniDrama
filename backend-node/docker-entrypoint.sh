#!/bin/sh
# Keep this file LF-terminated because Docker executes the shebang directly.
set -eu

config_source="${LOCALMINIDRAMA_CONFIG_SOURCE:-/app/configs/config.yaml}"
config_target="${LOCALMINIDRAMA_CONFIG_PATH:-/tmp/localminidrama-config/config.yaml}"
ownership_marker="/app/data/.localminidrama-owner-v1"

case "$config_target" in
  /tmp/*) ;;
  *)
    echo "LOCALMINIDRAMA_CONFIG_PATH must stay under /tmp" >&2
    exit 1
    ;;
esac

if [ ! -f "$config_source" ]; then
  echo "Runtime config source is missing" >&2
  exit 1
fi

config_target_dir="$(dirname "$config_target")"
mkdir -p "$config_target_dir"
node /usr/local/lib/localminidrama/runtime-config-policy.cjs "$config_source" "$config_target"
export LOCALMINIDRAMA_CONFIG_PATH="$config_target"

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  if [ -L "$ownership_marker" ] || { [ -e "$ownership_marker" ] && [ ! -f "$ownership_marker" ]; }; then
    echo "Data ownership marker must be a regular file" >&2
    exit 1
  fi
  if [ ! -f "$ownership_marker" ]; then
    # 首次挂载兼容历史 root 数据；不跨文件系统，也不跟随目录联接。
    find /app/data -xdev \( ! -user node -o ! -group node \) -exec chown -h node:node {} +
    (umask 077; set -C; : > "$ownership_marker")
    chown node:node "$ownership_marker"
  fi
  chown -R node:node "$config_target_dir"
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
