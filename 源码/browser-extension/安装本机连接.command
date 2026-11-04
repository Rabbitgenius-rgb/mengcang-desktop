#!/bin/zsh
set -eu
task_dir="${0:A:h}"
if command -v node >/dev/null 2>&1; then
  node "$task_dir/scripts/install-native-host.mjs"
else
  print '需要 Node.js 22 或更新版本。请在安装 Node.js 后重新运行。'
  exit 1
fi
print '连接已安装。请在 Chrome / Edge 中加载本文件夹，并保持梦藏打开。'
