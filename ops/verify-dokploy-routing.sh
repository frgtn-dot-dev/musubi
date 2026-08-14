#!/bin/sh
set -eu

expected=${1:-0.1.3}
internal=$(wget -qO- http://musubi-api-internal:7531/api/v1/server/ok)
printf '%s\n' "$internal"
printf '%s' "$internal" | grep -Fq "\"version\":\"$expected\""
