import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createManifestFromDirectory,
  compareReleaseVersions,
  serializeManifest,
  validateReleaseVersion,
  validateManifest,
  writeManifest,
} from './manifest.mjs';

const targets = [
  ['darwin', 'amd64'],
  ['darwin', 'arm64'],
  ['linux', 'amd64'],
  ['linux', 'arm64'],
  ['windows', 'amd64'],
  ['windows', 'arm64'],
];

function archiveName(version, os, arch) {
  return `jev_${version}_${os}_${arch}${os === 'windows' ? '.zip' : '.tar.gz'}`;
}

async function fixtureDirectory(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jev manifest test '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const version = options.version ?? '0.2.0';
  for (const [os, arch] of targets) {
    if (options.missing?.[0] === os && options.missing?.[1] === arch) continue;
    const file = archiveName(version, os, arch);
    const bytes = Buffer.from(`archive:${version}:${os}:${arch}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(directory, file), bytes);
    await writeFile(
      path.join(directory, `${file}.json`),
      JSON.stringify({
        version:
          options.sidecarVersion?.[0] === os && options.sidecarVersion?.[1] === arch
            ? options.sidecarVersion[2]
            : version,
        nodeVersion: options.nodeVersion ?? '24.21.0',
        os,
        arch,
        file:
          options.sidecarFile?.[0] === os && options.sidecarFile?.[1] === arch
            ? options.sidecarFile[2]
            : file,
        sha256:
          options.sidecarHash?.[0] === os && options.sidecarHash?.[1] === arch
            ? options.sidecarHash[2]
            : sha256,
      }),
    );
  }
  if (options.extra) {
    await writeFile(path.join(directory, options.extra), 'unexpected');
    await writeFile(
      path.join(directory, `${options.extra}.json`),
      JSON.stringify({
        version,
        nodeVersion: '24.21.0',
        os: 'linux',
        arch: 'amd64',
        file: options.extra,
        sha256: 'a'.repeat(64),
      }),
    );
  }
  return directory;
}

test('creates a deterministic manifest from the six expected verified archives', async (t) => {
  const directory = await fixtureDirectory(t);
  const manifest = await createManifestFromDirectory(directory);

  assert.deepEqual(manifest, {
    schemaVersion: 1,
    version: '0.2.0',
    nodeVersion: '24.21.0',
    repository: 'sriannamalai/Jev.UI',
    assets: [
      {
        os: 'darwin',
        arch: 'amd64',
        file: 'jev_0.2.0_darwin_amd64.tar.gz',
        sha256: '938caa8040d1e7bd27186b4422970d4fdb0bf2fdc8604572f6b22def1637d849',
      },
      {
        os: 'darwin',
        arch: 'arm64',
        file: 'jev_0.2.0_darwin_arm64.tar.gz',
        sha256: 'ce7ba5174913000bb0555c06c8d252f86f8e3cc9d02b55793daf82d5966e93d1',
      },
      {
        os: 'linux',
        arch: 'amd64',
        file: 'jev_0.2.0_linux_amd64.tar.gz',
        sha256: '421384f6e4266e5a7ac7d302b3faf63a71b4cbbb01601d1657ebcf0a43772e9f',
      },
      {
        os: 'linux',
        arch: 'arm64',
        file: 'jev_0.2.0_linux_arm64.tar.gz',
        sha256: '3803e6a7ebfa0e7e2c8a633f12e859aea1768ed8fe3a4dab6cb4531436e875da',
      },
      {
        os: 'windows',
        arch: 'amd64',
        file: 'jev_0.2.0_windows_amd64.zip',
        sha256: '38c46cc8b3c8fa7ec953040d6455330a2b10e763b8f2520dfff1d2ccb709e785',
      },
      {
        os: 'windows',
        arch: 'arm64',
        file: 'jev_0.2.0_windows_arm64.zip',
        sha256: '2746bb06becb47fcaad1878620fec6d33aa3a1ed469c4cede76d9e5da7b74c08',
      },
    ],
  });
  assert.equal(serializeManifest(manifest), `${JSON.stringify(manifest, null, 2)}\n`);

  const output = await writeManifest(directory, manifest);
  assert.equal(JSON.parse(await readFile(output.manifestPath, 'utf8')).version, '0.2.0');
  assert.match(
    await readFile(output.checksumsPath, 'utf8'),
    /^938caa80.*  jev_0\.2\.0_darwin_amd64\.tar\.gz/m,
  );
});

test('recomputes archive hashes instead of trusting sidecar claims', async (t) => {
  const directory = await fixtureDirectory(t, { sidecarHash: ['darwin', 'arm64', '0'.repeat(64)] });
  await assert.rejects(createManifestFromDirectory(directory), /sha256.*mismatch/i);
});

test('rejects missing, extra, and mismatched release archive metadata', async (t) => {
  await assert.rejects(
    createManifestFromDirectory(await fixtureDirectory(t, { missing: ['linux', 'arm64'] })),
    /six|missing/i,
  );
  await assert.rejects(
    createManifestFromDirectory(
      await fixtureDirectory(t, { extra: 'jev_0.2.0_linux_riscv64.tar.gz' }),
    ),
    /unexpected|six/i,
  );
  await assert.rejects(
    createManifestFromDirectory(
      await fixtureDirectory(t, { sidecarVersion: ['windows', 'arm64', '0.2.1'] }),
    ),
    /version|filename/i,
  );
  await assert.rejects(
    createManifestFromDirectory(
      await fixtureDirectory(t, { sidecarFile: ['windows', 'arm64', '../jev.zip'] }),
    ),
    /file|path/i,
  );
});

test('rejects malformed manifest versions, hashes, traversal, duplicate targets, and wrong cardinality', () => {
  const valid = {
    schemaVersion: 1,
    version: '0.2.0',
    nodeVersion: '24.21.0',
    repository: 'sriannamalai/Jev.UI',
    assets: targets.map(([os, arch]) => ({
      os,
      arch,
      file: archiveName('0.2.0', os, arch),
      sha256: 'a'.repeat(64),
    })),
  };
  assert.doesNotThrow(() => validateManifest(valid));
  assert.throws(() => validateManifest({ ...valid, version: '0.2.0+build' }), /version/i);
  assert.throws(
    () => validateManifest({ ...valid, assets: valid.assets.slice(0, 5) }),
    /six|missing/i,
  );
  assert.throws(
    () => validateManifest({ ...valid, assets: [...valid.assets.slice(0, 5), valid.assets[0]] }),
    /duplicate/i,
  );
  assert.throws(
    () =>
      validateManifest({
        ...valid,
        assets: valid.assets.map((asset, index) =>
          index === 0 ? { ...asset, file: '../escape.tar.gz' } : asset,
        ),
      }),
    /file|path/i,
  );
  assert.throws(
    () =>
      validateManifest({
        ...valid,
        assets: valid.assets.map((asset, index) =>
          index === 0 ? { ...asset, sha256: 'not-a-hash' } : asset,
        ),
      }),
    /sha256/i,
  );
});

test('validates safe release versions and orders prereleases for a later release gate', () => {
  assert.equal(validateReleaseVersion('1.2.3-beta.2'), '1.2.3-beta.2');
  assert.throws(() => validateReleaseVersion('1.2.3+build.7'), /version/i);
  assert.throws(() => validateReleaseVersion('../1.2.3'), /version/i);
  assert(compareReleaseVersions('1.2.3-alpha.2', '1.2.3-alpha.10') < 0);
  assert(compareReleaseVersions('1.2.3-rc.1', '1.2.3') < 0);
  assert.equal(compareReleaseVersions('1.2.3', '1.2.3'), 0);
  assert(compareReleaseVersions('1.2.3-alpha-x', '1.2.3-alpha-y') < 0);
  assert(compareReleaseVersions('9007199254740992.0.0', '9007199254740993.0.0') < 0);
  assert(compareReleaseVersions('1.2.3-9007199254740992', '1.2.3-9007199254740993') < 0);
  assert(compareReleaseVersions('1.2.3-A', '1.2.3-a') < 0);
});

test('rejects an orphan archive sidecar while allowing generated manifest outputs', async (t) => {
  const directory = await fixtureDirectory(t);
  await writeFile(path.join(directory, 'jev_0.1.0_linux_amd64.tar.gz.json'), '{}');
  await assert.rejects(createManifestFromDirectory(directory), /orphan|sidecar/i);
  await rm(path.join(directory, 'jev_0.1.0_linux_amd64.tar.gz.json'));
  await Promise.all([
    writeFile(path.join(directory, 'release-manifest.json'), '{}'),
    writeFile(path.join(directory, 'checksums.txt'), 'placeholder\n'),
  ]);
  await assert.doesNotReject(createManifestFromDirectory(directory));
});
