const { devDependencies } = require('../../package.json');
module.exports = {
  appId: 'su.octo.compact', productName: 'Octo Compact', executableName: 'Octo Compact',
  electronVersion: devDependencies.electron,
  directories: { output: '../../release/compact' },
  files: ['package.json', 'dist/**/*', '!dist/**/*.map'],
  extraResources: [{ from: '../../LICENSE', to: 'LICENSE.octo.txt' }],
  asar: true, npmRebuild: false, nodeGypRebuild: false, buildDependenciesFromSource: false,
  compression: 'maximum',
  win: { icon: 'dist/icon.ico', target: [{ target: 'nsis', arch: ['x64'] }], signAndEditExecutable: true, requestedExecutionLevel: 'asInvoker' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true,
    artifactName: 'Octo-Compact-Setup-${version}.${ext}', deleteAppDataOnUninstall: false },
  electronFuses: { runAsNode: false, enableCookieEncryption: true, enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false, grantFileProtocolExtraPrivileges: false },
  publish: null,
};
