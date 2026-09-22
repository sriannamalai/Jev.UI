import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  runBrewCandidate,
  runCapturedCommand,
  startCandidateServer,
  validateCandidateArchive,
} from './test-installers.mjs';

function nativeTarget() {
  return {
    os: process.platform === 'win32' ? 'windows' : process.platform,
    arch: process.arch === 'x64' ? 'amd64' : process.arch,
  };
}

function fullManifest(selected) {
  const targets = [
    ['darwin', 'amd64'],
    ['darwin', 'arm64'],
    ['linux', 'amd64'],
    ['linux', 'arm64'],
    ['windows', 'amd64'],
    ['windows', 'arm64'],
  ];
  return {
    schemaVersion: 1,
    version: '0.2.0',
    nodeVersion: '24.21.0',
    repository: 'sriannamalai/Jev.UI',
    assets: targets.map(([os, arch]) => ({
      os,
      arch,
      file: `jev_0.2.0_${os}_${arch}${os === 'windows' ? '.zip' : '.tar.gz'}`,
      sha256: os === selected.os && arch === selected.arch ? selected.sha256 : 'f'.repeat(64),
    })),
  };
}

test('serves only the verified native archive selected from a complete manifest', async (t) => {
  const artifacts = await mkdtemp(path.join(tmpdir(), 'jev candidate artifacts '));
  t.after(() => rm(artifacts, { recursive: true, force: true }));
  const target = nativeTarget();
  const bytes = Buffer.from('native candidate archive');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const selected = { ...target, sha256 };
  const manifest = fullManifest(selected);
  const file = manifest.assets.find(
    (asset) => asset.os === target.os && asset.arch === target.arch,
  ).file;
  await writeFile(path.join(artifacts, file), bytes);

  const candidate = await validateCandidateArchive(manifest, artifacts);
  assert.equal(candidate.file, file);
  assert.equal(candidate.sha256, sha256);
  const server = await startCandidateServer(artifacts, candidate);
  t.after(() => server.close());

  assert.deepEqual(
    Buffer.from(await (await fetch(`${server.baseUrl}/${file}`)).arrayBuffer()),
    bytes,
  );
  assert.equal((await fetch(`${server.baseUrl}/jev_0.2.0_other.tar.gz`)).status, 404);
});

test('rejects a candidate archive whose bytes no longer match the full manifest', async (t) => {
  const artifacts = await mkdtemp(path.join(tmpdir(), 'jev candidate mismatch '));
  t.after(() => rm(artifacts, { recursive: true, force: true }));
  const target = nativeTarget();
  const manifest = fullManifest({ ...target, sha256: '0'.repeat(64) });
  const file = manifest.assets.find(
    (asset) => asset.os === target.os && asset.arch === target.arch,
  ).file;
  await writeFile(path.join(artifacts, file), 'altered bytes');
  await assert.rejects(validateCandidateArchive(manifest, artifacts), /sha256.*mismatch/i);
});

test('cleans the uniquely owned Homebrew tap after a failed install and failed uninstall', async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'list') return { status: 1, stdout: '', stderr: '' };
    if (args[0] === 'tap-new') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === '--repository') return { status: 0, stdout: '/test/tap\n', stderr: '' };
    if (args[0] === 'install')
      return { status: 1, stdout: '', stderr: 'install failed after keg creation' };
    if (args[0] === 'uninstall') return { status: 1, stdout: '', stderr: 'uninstall failed' };
    if (args[0] === 'untap') return { status: 0, stdout: '', stderr: '' };
    throw new Error(`unexpected command: ${args.join(' ')}`);
  };

  await assert.rejects(
    runBrewCandidate('ignored.rb', {
      tap: 'jev-candidate/test',
      run,
      prepareFormula: async () => {},
      verifyInstalled: async () => {},
    }),
    AggregateError,
  );
  assert.deepEqual(calls.at(-2), [
    'brew',
    ['uninstall', '--formula', '--force', 'jev-candidate/test/jev'],
  ]);
  assert.deepEqual(calls.at(-1), ['brew', ['untap', 'jev-candidate/test']]);
});

test('fails closed when Homebrew cannot establish that Jev is absent', async () => {
  const calls = [];
  await assert.rejects(
    runBrewCandidate('ignored.rb', {
      tap: 'jev-candidate/test',
      run: async (command, args) => {
        calls.push([command, args]);
        return { status: 2, stdout: '', stderr: 'brew unavailable' };
      },
    }),
    /cannot verify/i,
  );
  assert.deepEqual(calls, [['brew', ['list', '--formula', 'jev']]]);
});

test('does not accept a hash rejection when its candidate tap cleanup fails', async () => {
  const calls = [];
  await assert.rejects(
    runBrewCandidate('ignored.rb', {
      tap: 'jev-candidate/bad-hash-cleanup',
      expectedInstallHashFailure: /checksum/i,
      run: async (command, args) => {
        calls.push([command, args]);
        if (args[0] === 'list') return { status: 1, stdout: '', stderr: '' };
        if (args[0] === 'tap-new') return { status: 0, stdout: '', stderr: '' };
        if (args[0] === '--repository') return { status: 0, stdout: '/test/tap\n', stderr: '' };
        if (args[0] === 'install') return { status: 1, stdout: '', stderr: 'checksum mismatch' };
        if (args[0] === 'uninstall') return { status: 0, stdout: '', stderr: '' };
        if (args[0] === 'untap') return { status: 1, stdout: '', stderr: 'untap failed' };
        throw new Error(`unexpected command: ${args.join(' ')}`);
      },
      prepareFormula: async () => {},
      verifyInstalled: async () => {},
    }),
    AggregateError,
  );
  assert.deepEqual(calls.at(-1), ['brew', ['untap', 'jev-candidate/bad-hash-cleanup']]);
});

test('terminates a hung package-manager subprocess at its explicit timeout', async () => {
  await assert.rejects(
    runCapturedCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeout: 25 }),
    /timed out/i,
  );
});
