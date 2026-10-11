// tools/ensure-deps.mjs
//
// Keeps node_modules in step with the sources that are about to run.
//
// A new version of the app (an update, a git pull, a copied checkout) can bring
// a changed package.json or package-lock.json. Starting Electron against a stale
// node_modules fails later with "Cannot find module", so every start asks this
// script first. It installs when:
//   - node_modules is missing, or no install has been recorded yet,
//   - package.json, package-lock.json, .npmrc, or a workspace package.json
//     changed since the last successful install (fingerprint mismatch),
//   - the Electron package or its binary is missing (only the Electron step runs).
//
// Uses Node built-ins only, because it must run before any dependency exists.
//
//   node tools/ensure-deps.mjs          install or repair if needed (0 ready, 2 failed)
//   node tools/ensure-deps.mjs --check  report only (0 ready, 1 needs work, 2 error)
//   OCTO_ROOT=<dir>                     check another root (used by the tests)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openSync, closeSync, unlinkSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FINGERPRINT_VERSION = 1;
export const LOCK_PATH = '.octo-deps.lock';
export const STAMP_PATH = path.join('node_modules', '.octo-deps-stamp.json');

const ROOT_INPUTS = ['package.json', 'package-lock.json', '.npmrc'];

/** Relative, forward-slash paths of every file that decides what gets installed. */
export function fingerprintInputPaths(root) {
  const workspaces = [];
  for (const group of ['apps', 'packages']) {
    const dir = path.join(root, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const rel = `${group}/${name}/package.json`;
      if (existsSync(path.join(root, rel))) workspaces.push(rel);
    }
  }
  return [...ROOT_INPUTS, ...workspaces];
}

/**
 * Pure: SHA-256 over the named inputs and the platform. `inputs` maps a relative
 * path to its contents, or to null when the file does not exist.
 */
export function fingerprintOf(inputs, platform = process.platform, arch = process.arch) {
  const hash = createHash('sha256');
  hash.update(`octo-deps-v${FINGERPRINT_VERSION}\n${platform}-${arch}\n`);
  for (const name of Object.keys(inputs).sort()) {
    const content = inputs[name];
    const digest = content === null || content === undefined
      ? 'absent'
      : createHash('sha256').update(content).digest('hex');
    hash.update(`${name}\t${digest}\n`);
  }
  return hash.digest('hex');
}

/** Reads the fingerprint inputs of a checkout from disk and fingerprints them. */
export function computeFingerprint(root, platform, arch) {
  const inputs = {};
  for (const rel of fingerprintInputPaths(root)) {
    const abs = path.join(root, rel);
    inputs[rel] = existsSync(abs) ? readFileSync(abs) : null;
  }
  return fingerprintOf(inputs, platform, arch);
}

/** Pure: true when the root manifest declares Electron. */
export function electronRequired(pkg) {
  return Boolean(pkg && ((pkg.dependencies && pkg.dependencies.electron)
    || (pkg.devDependencies && pkg.devDependencies.electron)));
}

/** True when the Electron package has been installed (its install script is there). */
export function electronPackagePresent(root) {
  return existsSync(path.join(root, 'node_modules', 'electron', 'install.js'));
}

/** True when Electron's install step left a runnable binary (path.txt -> dist/<path>). */
export function electronBinaryPresent(root) {
  const electronDir = path.join(root, 'node_modules', 'electron');
  const pathFile = path.join(electronDir, 'path.txt');
  if (!existsSync(pathFile)) return false;
  const relative = readFileSync(pathFile, 'utf8').trim();
  return relative !== '' && existsSync(path.join(electronDir, 'dist', relative));
}

/** Returns the platform-specific esbuild binary path, or null when it is absent. */
export function esbuildBinaryPath(root, platform = process.platform, arch = process.arch) {
  const dir = path.join(root, 'node_modules', 'esbuild');
  const pkg = `@esbuild/${platform}-${arch}`;
  const subpath = platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild';
  // Windows never puts an .exe in esbuild/bin: that directory holds a JS CLI.
  // Check esbuild-local and hoisted optional dependencies plus upstream's fallback.
  const candidates = [
    path.join(dir, 'node_modules', pkg, subpath),
    path.join(root, 'node_modules', pkg, subpath),
    path.join(dir, 'lib', `downloaded-${pkg.replace('/', '-')}-${path.basename(subpath)}`),
    ...(platform === 'win32' ? [] : [path.join(dir, 'bin', 'esbuild')]),
  ];
  return candidates.find(file => existsSync(file)) ?? null;
}

/** Returns the exact platform package esbuild expects for this process. */
export function esbuildPlatformPackage(root, platform = process.platform, arch = process.arch) {
  const packageFile = path.join(root, 'node_modules', 'esbuild', 'package.json');
  if (!existsSync(packageFile)) return null;
  try {
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
    const name = `@esbuild/${platform}-${arch}`;
    const version = pkg.optionalDependencies?.[name];
    return typeof version === 'string' ? { name, version } : null;
  } catch {
    return null;
  }
}

/** The Squirrel helper is optional at runtime but needs its selected 7-Zip pair for packaging. */
export function electronWinstallerArtifactsPresent(root) {
  const dir = path.join(root, 'node_modules', 'electron-winstaller');
  if (!existsSync(dir)) return true;
  return existsSync(path.join(dir, 'vendor', '7z.exe')) && existsSync(path.join(dir, 'vendor', '7z.dll'));
}

/**
 * Diagnostic only: identifies some existing build artifacts. Their presence
 * does not prove lockfile consistency and must never override a failed npm run.
 */
export function existingDependencyArtifactsPresent(root, pkg) {
  if (electronRequired(pkg) && (!electronPackagePresent(root) || !electronBinaryPresent(root))) return false;
  if (pkg?.devDependencies?.esbuild && !esbuildBinaryPath(root)) return false;
  if (pkg?.devDependencies?.typescript && !existsSync(path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'))) return false;
  return electronWinstallerArtifactsPresent(root);
}

/**
 * Repairs only the native package scripts this project uses. It does not approve
 * arbitrary package scripts: esbuild is required by the build, while the
 * electron-winstaller selector is needed only when that packaging dependency exists.
 */
export function verifyNativePackageArtifacts(root, { run = runCommand, log = writeLine, platform = process.platform, arch = process.arch } = {}) {
  const esbuildDir = path.join(root, 'node_modules', 'esbuild');
  if (existsSync(esbuildDir)) {
    let binary = esbuildBinaryPath(root, platform, arch);
    if (!binary) {
      const platformPackage = esbuildPlatformPackage(root, platform, arch);
      if (!platformPackage) {
        log(`esbuild does not declare a platform package for ${platform}-${arch}.`);
        return false;
      }
      const packageSpec = `${platformPackage.name}@${platformPackage.version}`;
      log(`esbuild native binary is missing; installing its optional package ${packageSpec} without running unrelated scripts.`);
      if (run('npm', [
        'install', '--no-save', '--no-package-lock', '--ignore-scripts', '--include=optional', packageSpec,
      ], root) !== 0) return false;
      const install = path.join(esbuildDir, 'install.js');
      log('running the verified esbuild install.js for the restored platform package.');
      if (!existsSync(install) || run(process.execPath, [install], root) !== 0) return false;
      binary = esbuildBinaryPath(root, platform, arch);
    }
    if (!binary) {
      log(`The esbuild ${platform}-${arch} executable is still missing after repair under ${esbuildDir}.`);
      return false;
    }
    const status = run(binary, ['--version'], root);
    if (status !== 0) {
      log(`esbuild verification failed (exit ${status}): ${binary} --version`);
      return false;
    }
  }

  const winstallerDir = path.join(root, 'node_modules', 'electron-winstaller');
  if (existsSync(winstallerDir) && !electronWinstallerArtifactsPresent(root)) {
    const selector = path.join(winstallerDir, 'script', 'select-7z-arch.js');
    log('electron-winstaller 7-Zip artifacts are missing; running its architecture selector.');
    if (!existsSync(selector) || run(process.execPath, [selector], winstallerDir) !== 0 || !electronWinstallerArtifactsPresent(root)) {
      log('electron-winstaller could not prepare its 7-Zip artifacts.');
      return false;
    }
  }
  return true;
}

/** The stamp written after a successful install, or null when there is none. */
export function readStamp(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, STAMP_PATH), 'utf8'));
  } catch {
    return null;
  }
}

export function writeStamp(root, fingerprint) {
  mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  const record = {
    version: FINGERPRINT_VERSION,
    fingerprint,
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    installedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(root, STAMP_PATH), `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Pure: decides the work to do.
 *   'install'  run the compatible npm install path (npm ci as the fallback), then repair Electron
 *   'electron' the dependencies match, only the Electron binary is missing
 *   'none'     nothing to do
 */
export function planDependencyWork({
  modulesPresent,
  stamp,
  fingerprint,
  electronNeeded,
  electronPackageInstalled,
  electronBinaryInstalled,
}) {
  if (!modulesPresent) {
    return { action: 'install', reason: 'node_modules is missing' };
  }
  if (!stamp || stamp.fingerprint !== fingerprint) {
    return {
      action: 'install',
      reason: 'package.json or package-lock.json changed since the last install, or no install is recorded yet',
    };
  }
  if (electronNeeded && !electronPackageInstalled) {
    return { action: 'install', reason: 'the electron package is missing from node_modules' };
  }
  if (electronNeeded && !electronBinaryInstalled) {
    return { action: 'electron', reason: 'the Electron binary is missing' };
  }
  return { action: 'none', reason: 'dependencies match the sources' };
}

/** Run npm's JavaScript entry point directly, never npm.cmd through a shell. */
export function resolveNpmCli(execPath = process.execPath, env = process.env, platform = process.platform) {
  const dirs = [path.dirname(execPath), ...String(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : path.delimiter).filter(Boolean)];
  const candidates = [
    env.npm_execpath,
    ...dirs.map(dir => path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')),
    path.resolve(path.dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find(file => file && path.basename(file) === 'npm-cli.js' && existsSync(file)) ?? null;
}

/** Runs a command and returns its exit status. Output goes to this console. */
export function runCommand(command, args, cwd, { platform = process.platform, execPath = process.execPath, env = process.env, spawn = spawnSync } = {}) {
  if (command === 'npm') {
    const cli = resolveNpmCli(execPath, env, platform);
    if (cli) { command = execPath; args = [cli, ...args]; }
    else if (platform === 'win32') {
      process.stderr.write('Cannot locate npm-cli.js beside Node.js or on PATH. Repair the Node.js installation.\n');
      return 1;
    }
  }
  const result = spawn(command, args, { cwd, env, stdio: 'inherit', shell: false });
  if (result.error) {
    process.stderr.write(`${result.error.code ?? 'spawn error'}: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

const writeLine = (line) => process.stdout.write(`${line}\n`);

/**
 * Makes the checkout at `root` ready to run. Returns { status, plan }:
 * 0 ready, 1 needs work (check mode only), 2 failed.
 */
export function ensureDependencies(root, options = {}) {
  // Keep the lock OUTSIDE node_modules: npm ci removes that directory.
  const lock = path.join(root, LOCK_PATH);
  let fd;
  try {
    fd = openSync(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const reason = `Another dependency setup owns ${lock}. Close the other installer and retry. If a previous setup crashed, first confirm its Node/npm processes have stopped, then remove only this lock file.`;
    (options.log ?? writeLine)(reason);
    return { status: 2, plan: { action: 'blocked', reason } };
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return ensureDependenciesUnlocked(root, options);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

function ensureDependenciesUnlocked(root, { checkOnly = false, run = runCommand, log = writeLine } = {}) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const electronNeeded = electronRequired(pkg);
  const plan = planDependencyWork({
    modulesPresent: existsSync(path.join(root, 'node_modules')),
    stamp: readStamp(root),
    fingerprint: computeFingerprint(root),
    electronNeeded,
    electronPackageInstalled: electronPackagePresent(root),
    electronBinaryInstalled: electronBinaryPresent(root),
  });

  if (plan.action === 'none') {
    log('Dependencies are up to date.');
    return { status: 0, plan };
  }
  if (checkOnly) {
    log(`Dependencies need attention: ${plan.reason}.`);
    return { status: 1, plan };
  }

  if (plan.action === 'install') {
    log(`Installing dependencies: ${plan.reason}.`);
    // The record goes first: an install that is interrupted (closed window, Ctrl+C, a
    // dropped network) must never look complete to the next start.
    rmSync(path.join(root, STAMP_PATH), { force: true });
    // npm ci is strict about every lockfile/platform edge case. On Windows a
    // copied checkout can contain optional native package metadata that npm ci
    // rejects even though npm install can repair it safely. Both commands keep
    // scripts disabled; native scripts are approved and run individually below.
    const installArgs = ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--include=optional'];
    const ciArgs = ['ci', '--no-audit', '--no-fund', '--ignore-scripts', '--include=optional'];
    const installStatus = run('npm', installArgs, root);
    if (installStatus !== 0) {
      log(`npm install failed with exit code ${installStatus}. Retrying with clean npm ci.`);
      const ciStatus = run('npm', ciArgs, root);
      if (ciStatus !== 0) {
        log(`Dependency installation failed: npm install=${installStatus}, npm ci=${ciStatus}. Setup cannot continue after failed dependency installation; inspect the npm error above.`);
        return { status: 2, plan };
      }
    }
  } else {
    log(`Repairing dependencies: ${plan.reason}.`);
  }

  if (!verifyNativePackageArtifacts(root, { run, log })) {
    log('Required native package setup did not complete. Check the npm output and run the installer again.');
    return { status: 2, plan };
  }

  if (electronNeeded && !electronBinaryPresent(root)) {
    log('Installing the Electron binary.');
    const installScript = path.join(root, 'node_modules', 'electron', 'install.js');
    if (!existsSync(installScript) || run(process.execPath, [installScript], root) !== 0 || !electronBinaryPresent(root)) {
      log('The Electron binary could not be installed. Check the network, then start again.');
      return { status: 2, plan };
    }
  }

  if (plan.action === 'install') {
    // Record success only after all required native binaries are present.
    // Fingerprint after install because npm install may rewrite the lockfile.
    writeStamp(root, computeFingerprint(root));
  }

  log('Dependencies are ready.');
  return { status: 0, plan };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const root = path.resolve(env.OCTO_ROOT || defaultRoot);
  try {
    return ensureDependencies(root, { checkOnly: argv.includes('--check') }).status;
  } catch (error) {
    process.stderr.write(`Dependency check failed: ${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
