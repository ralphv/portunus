#!/bin/sh
# Portunus container entrypoint: resolves `*_FILE` environment variables,
# then runs the server (the image's CMD).
#
# For every variable named `NAME_FILE`, the contents of the file it points to
# become `NAME`, and `NAME_FILE` is removed — so any setting can come from a
# Docker / Kubernetes secret mount, e.g.
#   AUTH_SECRET_FILE=/run/secrets/auth_secret  ->  AUTH_SECRET=<file contents>
# Trailing newlines (LF or CRLF) are stripped.
#
# Refuses to start when both NAME and NAME_FILE are set, or when the file is
# missing, unreadable or empty. Errors name the variable and path, never the
# file's contents.
#
# Resolved here, before Node starts, so every reader sees the value: Auth.js
# reading AUTH_* itself, the edge-runtime middleware, and the app code.
# Tested by docker-entrypoint.test.ts.
set -eu

CR=$(printf '\r')
LF='
'

fail() {
  echo "portunus-entrypoint: $*" >&2
  exit 1
}

# Names only (values may span lines), valid shell identifiers ending in _FILE.
names=$(awk 'BEGIN {
  for (k in ENVIRON) if (k ~ /^[A-Za-z_][A-Za-z0-9_]*_FILE$/ && k != "_FILE") print k
}' | sort)

for name in $names; do
  base=${name%_FILE}
  eval "path=\${$name}"
  eval "already=\${$base+set}"
  [ -z "$already" ] || fail "both $base and $name are set; set only one"
  [ -n "$path" ] || fail "$name is empty"
  [ -f "$path" ] || fail "$name: $path is not a file"
  [ -r "$path" ] || fail "$name: $path is not readable"
  # Command substitution drops trailing LFs; then drop any trailing CR/LF mix.
  value=$(cat "$path")
  while :; do
    case $value in
      *"$CR") value=${value%"$CR"} ;;
      *"$LF") value=${value%"$LF"} ;;
      *) break ;;
    esac
  done
  [ -n "$value" ] || fail "$name: $path is empty"
  export "$base=$value"
  unset "$name"
done

exec "$@"
