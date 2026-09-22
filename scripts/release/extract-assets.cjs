'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Node SEA bootstrap is CommonJS. */

const { chmod, mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function validateAssetPath(name) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    path.posix.isAbsolute(name) ||
    path.win32.isAbsolute(name) ||
    name.includes('\\') ||
    name.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe asset path: ${String(name)}`);
  }
  return name;
}

async function extractAssets({ assets, getAsset, tmpRoot = tmpdir() }) {
  const directory = await mkdtemp(path.join(tmpRoot, 'jev-'));
  await chmod(directory, 0o700);

  try {
    for (const asset of assets) {
      const name = validateAssetPath(asset.name);
      const destination = path.join(directory, ...name.split('/'));
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, Buffer.from(getAsset(name)), { mode: asset.mode ?? 0o600 });
      await chmod(destination, asset.mode ?? 0o600);
    }
    return { directory };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function runExtractedApplication({
  assets,
  getAsset,
  tmpRoot,
  importApplication = async (applicationPath) => import(pathToFileURL(applicationPath).href),
}) {
  const originalCwd = process.cwd();
  const previousAssetDir = process.env.JEV_UI_ASSET_DIR;
  const extracted = await extractAssets({ assets, getAsset, tmpRoot });
  process.env.JEV_UI_ASSET_DIR = extracted.directory;
  try {
    return await importApplication(path.join(extracted.directory, 'app.mjs'), extracted.directory);
  } finally {
    process.chdir(originalCwd);
    if (previousAssetDir === undefined) delete process.env.JEV_UI_ASSET_DIR;
    else process.env.JEV_UI_ASSET_DIR = previousAssetDir;
    await rm(extracted.directory, { recursive: true, force: true });
  }
}

module.exports = { extractAssets, runExtractedApplication, validateAssetPath };
