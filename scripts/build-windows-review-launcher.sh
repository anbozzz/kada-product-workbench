#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
app_root=${script_dir:h}
zig_bin=${ZIG_BIN:-zig}
output_path="$app_root/runtime/windows-x64/open-review.exe"

mkdir -p "${output_path:h}"
"$zig_bin" cc \
  -target x86_64-windows-gnu \
  -Os \
  -s \
  -o "$output_path" \
  "$app_root/scripts/windows-review-launcher/main.c" \
  -lws2_32 \
  -lshell32

echo "Windows x64 评审查看器已生成：$output_path"
