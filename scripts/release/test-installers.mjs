import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInstallerFiles } from './installers.mjs';
import { serializeManifest, validateManifest } from './manifest.mjs';
import { verifyNativeTarget } from './verify-native-target.mjs';

const releaseDirectory = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_COMMAND_TIMEOUT = 300_000;
const CLEANUP_COMMAND_TIMEOUT = 60_000;
const TERMINATION_TIMEOUT = 10_000;

function nativeTarget() {
  return {
    os: process.platform === 'win32' ? 'windows' : process.platform,
    arch: process.arch === 'x64' ? 'amd64' : process.arch,
  };
}

export function runCapturedCommand(command, args, options = {}) {
  const { timeout: timeoutMs = PACKAGE_COMMAND_TIMEOUT, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'pipe',
      detached: process.platform !== 'win32',
      ...spawnOptions,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timingOut = false;
    let closeChild;
    const childClosed = new Promise((close) => {
      closeChild = close;
    });
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const terminate = async () => {
      if (process.platform === 'win32') {
        await new Promise((done) => {
          const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
          });
          taskkill.once('error', done);
          taskkill.once('close', done);
        });
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
        child.kill('SIGKILL');
      }
    };
    child.stdout?.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr?.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    const timeout = setTimeout(async () => {
      if (settled || timingOut) return;
      timingOut = true;
      await terminate();
      await new Promise((done) => {
        const terminationTimeout = setTimeout(done, TERMINATION_TIMEOUT);
        void childClosed.then(() => {
          clearTimeout(terminationTimeout);
          done();
        });
      });
      settle(() => reject(new Error(`Timed out: ${command} ${args.join(' ')}`)));
    }, timeoutMs);
    child.once('error', (error) => settle(() => reject(error)));
    child.once('close', (status, signal) => {
      closeChild();
      if (!timingOut) settle(() => resolve({ status, signal, stdout, stderr }));
    });
  });
}

function requireSuccess(result, label) {
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  return result;
}

export async function validateCandidateArchive(
  manifest,
  artifactsDirectory,
  target = nativeTarget(),
) {
  validateManifest(manifest);
  const asset = manifest.assets.find(
    (entry) => entry.os === target.os && entry.arch === target.arch,
  );
  if (!asset) throw new Error(`manifest has no native asset for ${target.os}/${target.arch}`);
  const file = path.resolve(artifactsDirectory, asset.file);
  if (path.dirname(file) !== path.resolve(artifactsDirectory))
    throw new Error(`unsafe candidate asset path: ${asset.file}`);
  if (!(await stat(file)).isFile())
    throw new Error(`native candidate archive is missing: ${asset.file}`);
  const actual = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  if (actual !== asset.sha256) throw new Error(`native candidate sha256 mismatch: ${asset.file}`);
  return asset;
}

export async function startCandidateServer(artifactsDirectory, asset) {
  const archivePath = path.resolve(artifactsDirectory, asset.file);
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== `/${encodeURIComponent(asset.file)}`) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, { 'content-type': 'application/octet-stream' })
      .end(await readFile(archivePath));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function aggregate(operationError, cleanupErrors) {
  if (operationError && cleanupErrors.length) {
    return new AggregateError(
      [operationError, ...cleanupErrors],
      'candidate installation and cleanup failed',
    );
  }
  if (operationError) return operationError;
  if (cleanupErrors.length) return new AggregateError(cleanupErrors, 'candidate cleanup failed');
  return undefined;
}

async function verifyInstalledBinary(executable, target, metadataPath, run) {
  verifyNativeTarget(await readFile(executable), {
    platform: process.platform,
    arch: process.arch,
  });
  requireSuccess(
    await run(process.execPath, [
      path.join(releaseDirectory, 'smoke-binary.mjs'),
      executable,
      metadataPath,
    ]),
    `running Node-free offline smoke for ${target.os}/${target.arch}`,
  );
}

export async function runBrewCandidate(
  formulaPath,
  {
    tap = `jev-candidate/${randomUUID().replaceAll('-', '')}`,
    run = runCapturedCommand,
    metadataPath,
    expectedInstallHashFailure,
    prepareFormula = async (source, destination) => {
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
    },
    verifyInstalled = verifyInstalledBinary,
  } = {},
) {
  const existing = await run('brew', ['list', '--formula', 'jev']);
  if (existing.status === 0)
    throw new Error('refusing to touch a pre-existing Homebrew jev installation');
  if (existing.status !== 1) {
    throw new Error(`cannot verify Homebrew jev is absent: ${existing.stderr || existing.stdout}`);
  }
  let ownTap = false;
  let ownInstall = false;
  let operationError;
  let expectedHashRejected = false;
  try {
    ownTap = true;
    requireSuccess(
      await run('brew', ['tap-new', '--no-git', tap]),
      'creating isolated Homebrew tap',
    );
    const repository = requireSuccess(
      await run('brew', ['--repository', tap]),
      'locating isolated Homebrew tap',
    ).stdout.trim();
    const destination = path.join(repository, 'Formula', 'jev.rb');
    await prepareFormula(formulaPath, destination);
    ownInstall = true;
    const installation = await run('brew', ['install', `${tap}/jev`]);
    if (installation.status !== 0) {
      const error = new Error(
        `installing Homebrew candidate failed: ${installation.stderr || installation.stdout}`,
      );
      if (expectedInstallHashFailure?.test(error.message)) expectedHashRejected = true;
      else throw error;
    }
    if (!expectedHashRejected) {
      const prefix = requireSuccess(
        await run('brew', ['--prefix', `${tap}/jev`]),
        'locating installed Homebrew candidate',
      ).stdout.trim();
      await verifyInstalled(path.join(prefix, 'bin', 'jev'), nativeTarget(), metadataPath, run);
      requireSuccess(await run('brew', ['test', `${tap}/jev`]), 'testing Homebrew candidate');
    }
  } catch (error) {
    operationError = error;
  } finally {
    const cleanupErrors = [];
    if (ownInstall) {
      try {
        requireSuccess(
          await run('brew', ['uninstall', '--formula', '--force', `${tap}/jev`], {
            timeout: CLEANUP_COMMAND_TIMEOUT,
          }),
          'removing Homebrew candidate',
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (ownTap) {
      try {
        requireSuccess(
          await run('brew', ['untap', tap], { timeout: CLEANUP_COMMAND_TIMEOUT }),
          'removing isolated Homebrew tap',
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    operationError = aggregate(operationError, cleanupErrors);
  }
  if (operationError) throw operationError;
  if (expectedInstallHashFailure && !expectedHashRejected) {
    throw new Error('Homebrew candidate did not reject the deliberately wrong hash');
  }
  return { expectedHashRejected };
}

function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function scoopCandidate(manifestPath, testRoot) {
  const script = path.join(testRoot, 'install-scoop-candidate.ps1');
  const content = `$ErrorActionPreference = 'Stop'
$root = ${powershellLiteral(testRoot)}
$manifest = ${powershellLiteral(manifestPath)}
$node = ${powershellLiteral(process.execPath)}
$verifyScript = ${powershellLiteral(path.join(releaseDirectory, 'verify-native-target.mjs'))}
$smokeScript = ${powershellLiteral(path.join(releaseDirectory, 'smoke-binary.mjs'))}
$targetArch = ${powershellLiteral(process.arch)}
$registryNames = @('Path', 'SCOOP', 'SCOOP_GLOBAL', 'SCOOP_CACHE', 'XDG_CONFIG_HOME')
$registrySnapshot = @{}
foreach ($name in $registryNames) {
  $entry = Get-ItemProperty -Path HKCU:\Environment -Name $name -ErrorAction SilentlyContinue
  $registrySnapshot[$name] = @{ Exists = $null -ne $entry; Value = if ($null -ne $entry) { $entry.$name } else { $null } }
}

try {
  $env:SCOOP = Join-Path $root 'scoop'
  $env:SCOOP_GLOBAL = Join-Path $root 'global'
  $env:SCOOP_CACHE = Join-Path $root 'cache'
  $env:XDG_CONFIG_HOME = Join-Path $root 'config'
  $installer = Join-Path $root 'install-scoop.ps1'
  Invoke-RestMethod -Uri https://get.scoop.sh -OutFile $installer
  & $installer -ScoopDir $env:SCOOP -ScoopGlobalDir $env:SCOOP_GLOBAL -ScoopCacheDir $env:SCOOP_CACHE
  $scoop = Join-Path $env:SCOOP 'shims\\scoop.ps1'
  $architecture = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { '64bit' }
  $badManifest = Join-Path $root 'jev-bad-hash.json'
  $bad = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
  $bad.architecture.$architecture.hash = ('0' * 64)
  $bad | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $badManifest -NoNewline
  & $scoop install $badManifest --no-update-scoop
  if ($LASTEXITCODE -eq 0) { throw 'Scoop accepted deliberately wrong candidate hash' }
  if (Test-Path -LiteralPath (Join-Path $env:SCOOP 'shims\\jev.exe')) { throw 'Scoop created a usable shim after hash failure' }
  & $scoop install $manifest --no-update-scoop
  $installed = Join-Path $env:SCOOP 'apps\\jev\\current\\jev.exe'
  if (-not (Test-Path -LiteralPath $installed)) { throw 'Scoop candidate executable is missing' }
  & $node $verifyScript win32 $targetArch $installed
  if ($LASTEXITCODE -ne 0) { throw 'Scoop candidate architecture verification failed' }
  $savedPath = $env:PATH
  try {
    $env:PATH = "$env:SCOOP\\shims;$env:SystemRoot\\System32;$env:SystemRoot"
    if (Get-Command node -ErrorAction SilentlyContinue) { throw 'Node leaked into candidate test PATH' }
    $shim = Join-Path $env:SCOOP 'shims\\jev.exe'
    if (-not (Test-Path -LiteralPath $shim)) { throw 'Scoop candidate shim is missing' }
    $versionOutput = & $shim --version
    if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^\d+\.\d+\.\d+') { throw 'Scoop shim --version failed' }
    $helpOutput = & $shim --help
    if ($LASTEXITCODE -ne 0 -or $helpOutput -notmatch 'Usage:') { throw 'Scoop shim --help failed' }
    $metadata = Join-Path $env:SCOOP 'apps\\jev\\current\\build-metadata.json'
    if (-not (Test-Path -LiteralPath $metadata)) { throw 'Scoop candidate metadata is missing' }
    & $node $smokeScript $installed $metadata
    if ($LASTEXITCODE -ne 0) { throw 'Scoop candidate offline smoke failed' }
  } finally { $env:PATH = $savedPath }
} finally {
  $cleanupFailures = @()
  if (Test-Path $env:SCOOP) {
    $scoop = Join-Path $env:SCOOP 'shims\\scoop.ps1'
    if (Test-Path $scoop) {
      & $scoop uninstall jev -ErrorAction SilentlyContinue
      if ($LASTEXITCODE -ne 0) { $cleanupFailures += 'Scoop candidate uninstall failed' }
    }
  }
  foreach ($name in $registryNames) {
    try {
      $snapshot = $registrySnapshot[$name]
      if ($snapshot.Exists) { Set-ItemProperty -Path HKCU:\Environment -Name $name -Value $snapshot.Value }
      else { Remove-ItemProperty -Path HKCU:\Environment -Name $name -ErrorAction SilentlyContinue }
    } catch { $cleanupFailures += "registry restore failed for $name: $_" }
  }
  if ($cleanupFailures.Count -gt 0) { throw ($cleanupFailures -join '; ') }
}
`;
  await writeFile(script, content);
  requireSuccess(
    await runCapturedCommand('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
    ]),
    'installing isolated Scoop candidate',
  );
}

async function stageArchiveMetadata(archivePath, destination) {
  const extracted = requireSuccess(
    await runCapturedCommand('tar', ['-xOf', archivePath, 'build-metadata.json']),
    'extracting candidate build metadata',
  );
  await writeFile(destination, extracted.stdout);
  return destination;
}

export async function runCandidateInstaller({
  manifest,
  artifactsDirectory,
  outputDirectory,
  testRoot = tmpdir(),
}) {
  const asset = await validateCandidateArchive(manifest, artifactsDirectory);
  const root = await mkdtemp(path.join(testRoot, 'jev-installer-candidate-'));
  let server;
  let operationError;
  try {
    const archiveDirectory = path.join(root, 'artifacts');
    const generated = path.join(root, 'installers');
    await mkdir(archiveDirectory);
    await copyFile(
      path.join(artifactsDirectory, asset.file),
      path.join(archiveDirectory, asset.file),
    );
    await writeFile(
      path.join(archiveDirectory, 'release-manifest.json'),
      serializeManifest(manifest),
    );
    const metadataPath =
      process.platform === 'win32'
        ? undefined
        : await stageArchiveMetadata(
            path.join(archiveDirectory, asset.file),
            path.join(root, 'build-metadata.json'),
          );
    server = await startCandidateServer(archiveDirectory, asset);
    const files = createInstallerFiles(manifest, { baseUrl: server.baseUrl });
    if (
      /github\.com\/.*releases\/download/.test(files.scoop) ||
      /github\.com\/.*releases\/download/.test(files.formula)
    ) {
      throw new Error('candidate installers leaked a production release URL');
    }
    await mkdir(generated);
    const scoopPath = path.join(generated, 'jev.json');
    const formulaPath = path.join(generated, 'Formula', 'jev.rb');
    await mkdir(path.dirname(formulaPath), { recursive: true });
    await Promise.all([writeFile(scoopPath, files.scoop), writeFile(formulaPath, files.formula)]);
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true });
      await Promise.all([
        copyFile(scoopPath, path.join(outputDirectory, 'jev.json')),
        copyFile(formulaPath, path.join(outputDirectory, 'jev.rb')),
      ]);
    }
    if (process.platform === 'win32') await scoopCandidate(scoopPath, root);
    else {
      const badManifest = {
        ...manifest,
        assets: manifest.assets.map((entry) =>
          entry.os === asset.os && entry.arch === asset.arch
            ? { ...entry, sha256: '0'.repeat(64) }
            : entry,
        ),
      };
      const badFormulaPath = path.join(generated, 'Formula', 'jev-bad-hash.rb');
      await writeFile(
        badFormulaPath,
        createInstallerFiles(badManifest, { baseUrl: server.baseUrl }).formula,
      );
      const badHash = await runBrewCandidate(badFormulaPath, {
        metadataPath,
        expectedInstallHashFailure: /checksum|sha256|hash/i,
      });
      if (!badHash.expectedHashRejected) {
        throw new Error('Homebrew accepted deliberately wrong candidate hash');
      }
      await runBrewCandidate(formulaPath, { metadataPath });
    }
  } catch (error) {
    operationError = error;
  } finally {
    const cleanupErrors = [];
    if (server) {
      try {
        await server.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    const error = aggregate(operationError, cleanupErrors);
    if (error) throw error;
  }
}

async function main(argv) {
  if (argv.length < 2 || argv.length > 4) {
    throw new Error(
      'usage: node scripts/release/test-installers.mjs <manifest-path> <artifacts-dir> [output-dir] [test-root]',
    );
  }
  const [manifestPath, artifactsDirectory, outputDirectory, testRoot] = argv;
  await runCandidateInstaller({
    manifest: JSON.parse(await readFile(manifestPath, 'utf8')),
    artifactsDirectory,
    outputDirectory,
    testRoot,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
