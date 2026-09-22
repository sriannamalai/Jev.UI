import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  extractAssets,
  runExtractedApplication,
  validateAssetPath,
} = require('./extract-assets.cjs');

const sampleAssets = [
  { name: 'app.mjs', mode: 0o600 },
  { name: 'web/index.html', mode: 0o600 },
  { name: 'xdg-open', mode: 0o755 },
];

function getAsset(name) {
  return Buffer.from(`asset:${name}`);
}

test('validateAssetPath rejects parent traversal and absolute names', () => {
  for (const name of ['../escape', 'web/../../escape', '/absolute', 'C:\\absolute']) {
    assert.throws(() => validateAssetPath(name), /unsafe asset path/i, name);
  }
});

test('extractAssets uses a fresh private directory and applies executable modes', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'jev release test '));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });

  const first = await extractAssets({ assets: sampleAssets, getAsset, tmpRoot: root });
  const second = await extractAssets({ assets: sampleAssets, getAsset, tmpRoot: root });
  assert.notEqual(first.directory, second.directory);
  assert.equal(
    await readFile(path.join(first.directory, 'web/index.html'), 'utf8'),
    'asset:web/index.html',
  );
  assert.equal((await stat(path.join(first.directory, 'xdg-open'))).mode & 0o777, 0o755);
  assert.equal((await stat(first.directory)).mode & 0o777, 0o700);
});

test('runExtractedApplication preserves cwd and cleans up when the application throws', async () => {
  const originalCwd = process.cwd();
  let extractedDirectory;

  await assert.rejects(
    runExtractedApplication({
      assets: sampleAssets,
      getAsset,
      importApplication: async (applicationPath, directory) => {
        extractedDirectory = directory;
        process.chdir(directory);
        assert.equal(applicationPath, path.join(directory, 'app.mjs'));
        throw new Error('application failed');
      },
    }),
    /application failed/,
  );

  assert.equal(process.cwd(), originalCwd);
  await assert.rejects(access(extractedDirectory));
});
