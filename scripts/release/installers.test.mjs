import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createInstallerFiles, installerBaseUrl, writeInstallers } from './installers.mjs';

const manifest = {
  schemaVersion: 1,
  version: '0.2.0',
  nodeVersion: '24.21.0',
  repository: 'sriannamalai/Jev.UI',
  assets: [
    { os: 'darwin', arch: 'amd64', file: 'jev_0.2.0_darwin_amd64.tar.gz', sha256: '1'.repeat(64) },
    { os: 'darwin', arch: 'arm64', file: 'jev_0.2.0_darwin_arm64.tar.gz', sha256: '2'.repeat(64) },
    { os: 'linux', arch: 'amd64', file: 'jev_0.2.0_linux_amd64.tar.gz', sha256: '3'.repeat(64) },
    { os: 'linux', arch: 'arm64', file: 'jev_0.2.0_linux_arm64.tar.gz', sha256: '4'.repeat(64) },
    { os: 'windows', arch: 'amd64', file: 'jev_0.2.0_windows_amd64.zip', sha256: '5'.repeat(64) },
    { os: 'windows', arch: 'arm64', file: 'jev_0.2.0_windows_arm64.zip', sha256: '6'.repeat(64) },
  ],
};

test('creates Scoop architecture entries and a Ruby-valid native Homebrew formula', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jev installers test '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = createInstallerFiles(manifest);
  const scoop = JSON.parse(files.scoop);

  assert.equal(
    installerBaseUrl(manifest),
    'https://github.com/sriannamalai/Jev.UI/releases/download/v0.2.0',
  );
  assert.deepEqual(scoop.architecture['64bit'], {
    url: 'https://github.com/sriannamalai/Jev.UI/releases/download/v0.2.0/jev_0.2.0_windows_amd64.zip',
    hash: '5'.repeat(64),
    bin: 'jev.exe',
  });
  assert.equal(scoop.architecture.arm64.hash, '6'.repeat(64));
  assert.match(
    files.formula,
    /on_macos do[\s\S]*on_arm do[\s\S]*darwin_arm64[\s\S]*on_intel do[\s\S]*darwin_amd64/,
  );
  assert.match(
    files.formula,
    /on_linux do[\s\S]*on_arm do[\s\S]*linux_arm64[\s\S]*on_intel do[\s\S]*linux_amd64/,
  );
  assert.match(files.formula, /bin\.install "jev"/);
  assert.doesNotMatch(files.formula, /depends_on|node|pnpm|curl/);

  const written = await writeInstallers(manifest, directory);
  assert.deepEqual(JSON.parse(await readFile(written.scoopPath, 'utf8')), scoop);
  const ruby = spawnSync('ruby', ['-c', written.formulaPath], { encoding: 'utf8' });
  assert.equal(ruby.status, 0, ruby.stderr);
  const tap = `jev-test/${randomUUID().replaceAll('-', '')}`;
  let tapped = false;
  try {
    const tapNew = spawnSync('brew', ['tap-new', '--no-git', tap], { encoding: 'utf8' });
    assert.equal(tapNew.status, 0, tapNew.stderr || tapNew.stdout);
    tapped = true;
    const repository = spawnSync('brew', ['--repository', tap], { encoding: 'utf8' });
    assert.equal(repository.status, 0, repository.stderr || repository.stdout);
    const tapFormula = path.join(repository.stdout.trim(), 'Formula', 'jev.rb');
    await copyFile(written.formulaPath, tapFormula);
    const brew = spawnSync('brew', ['style', '--formula', `${tap}/jev`], { encoding: 'utf8' });
    assert.equal(brew.status, 0, brew.stderr || brew.stdout);
  } finally {
    if (tapped) spawnSync('brew', ['untap', tap], { encoding: 'utf8' });
  }
});

test('uses a loopback candidate URL only when explicitly requested', () => {
  const files = createInstallerFiles(manifest, { baseUrl: 'http://127.0.0.1:8765/assets' });
  assert.match(files.scoop, /http:\/\/127\.0\.0\.1:8765\/assets\/jev_0\.2\.0_windows_amd64\.zip/);
  assert.doesNotMatch(files.scoop, /github\.com\/sriannamalai\/Jev\.UI\/releases\/download/);
  assert.throws(
    () => createInstallerFiles(manifest, { baseUrl: 'http://example.test/assets' }),
    /loopback|https/i,
  );
  assert.throws(
    () => createInstallerFiles(manifest, { baseUrl: 'file:///tmp/assets' }),
    /base URL/i,
  );
});

test('refuses invalid or incomplete manifests before emitting an installer', () => {
  assert.throws(
    () => createInstallerFiles({ ...manifest, assets: manifest.assets.slice(0, 5) }),
    /six|missing/i,
  );
  assert.throws(() => createInstallerFiles({ ...manifest, version: '0.2.0+build' }), /version/i);
  assert.throws(
    () =>
      createInstallerFiles({
        ...manifest,
        assets: [...manifest.assets.slice(0, 5), manifest.assets[0]],
      }),
    /duplicate/i,
  );
});

test('rejects a present --base-url flag without its candidate URL', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jev installers cli '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifestPath = path.join(directory, 'release-manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const result = spawnSync(
    process.execPath,
    ['./installers.mjs', manifestPath, directory, '--base-url'],
    {
      cwd: path.dirname(new URL(import.meta.url).pathname),
      encoding: 'utf8',
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing --base-url value/i);
});
