'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Only governance candidates embed this capability. All selectable directories
// must already exist inside a randomly allocated run, including on a restart.
function acceptanceProfile(config, selector) {
  if (!config.acceptanceRunsRoot || !path.isAbsolute(config.acceptanceRunsRoot) || !/^run-[A-Za-z0-9]{6}\/[a-z][a-z0-9-]{0,39}$/.test(selector)) {
    throw Error('此应用或运行目录不支持桌面验收。');
  }
  const root = fs.realpathSync(config.acceptanceRunsRoot);
  if (root !== path.resolve(config.acceptanceRunsRoot)) throw Error('验收根目录不得通过链接重定向。');
  const [run, profile] = selector.split('/');
  function local(...segments) {
    const target = path.join(root, run, ...segments);
    if (fs.realpathSync(target) !== target || !fs.statSync(target).isDirectory()) throw Error('验收目录无效或已重定向。');
    return target;
  }
  return {
    ...config,
    userDataPath: local(profile, 'profile'),
    vaultPath: local('vault'),
    recallBridgeDirectory: local(profile, 'bridge'),
    recallCompanionDirectory: local(profile, 'companion'),
  };
}
module.exports = {acceptanceProfile};
