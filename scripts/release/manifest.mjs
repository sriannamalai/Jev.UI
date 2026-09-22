import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'sriannamalai/Jev.UI';
export const EXPECTED_TARGETS = [
  { os: 'darwin', arch: 'amd64' },
  { os: 'darwin', arch: 'arm64' },
  { os: 'linux', arch: 'amd64' },
  { os: 'linux', arch: 'arm64' },
  { os: 'windows', arch: 'amd64' },
  { os: 'windows', arch: 'arm64' },
];

const semver =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/;
const sha256 = /^[a-f0-9]{64}$/;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateReleaseVersion(value, label = 'release version') {
  invariant(typeof value === 'string' && semver.test(value), `invalid ${label}: ${String(value)}`);
  return value;
}

function validVersion(value, label) {
  return validateReleaseVersion(value, label);
}

export function compareReleaseVersions(left, right) {
  validateReleaseVersion(left, 'left release version');
  validateReleaseVersion(right, 'right release version');
  const splitVersion = (value) => {
    const separator = value.indexOf('-');
    return separator === -1
      ? [value, undefined]
      : [value.slice(0, separator), value.slice(separator + 1)];
  };
  const compareNumeric = (first, second) => {
    if (first.length !== second.length) return first.length - second.length;
    return first < second ? -1 : first > second ? 1 : 0;
  };
  const [leftCore, leftPrerelease] = splitVersion(left);
  const [rightCore, rightPrerelease] = splitVersion(right);
  const leftCoreParts = leftCore.split('.');
  const rightCoreParts = rightCore.split('.');
  for (let index = 0; index < 3; index += 1) {
    const difference = compareNumeric(leftCoreParts[index], rightCoreParts[index]);
    if (difference) return difference;
  }
  if (leftPrerelease === undefined) return rightPrerelease === undefined ? 0 : 1;
  if (rightPrerelease === undefined) return -1;
  const leftParts = leftPrerelease.split('.');
  const rightParts = rightPrerelease.split('.');
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] === undefined) return -1;
    if (rightParts[index] === undefined) return 1;
    if (leftParts[index] === rightParts[index]) continue;
    const leftNumber = /^\d+$/.test(leftParts[index]);
    const rightNumber = /^\d+$/.test(rightParts[index]);
    if (leftNumber && rightNumber) return compareNumeric(leftParts[index], rightParts[index]);
    if (leftNumber) return -1;
    if (rightNumber) return 1;
    return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

function targetKey(os, arch) {
  return `${os}/${arch}`;
}

function knownTarget(os, arch) {
  return EXPECTED_TARGETS.some((target) => target.os === os && target.arch === arch);
}

export function archiveFilename(version, os, arch) {
  validVersion(version, 'version');
  invariant(knownTarget(os, arch), `unsupported target: ${os}/${arch}`);
  return `jev_${version}_${os}_${arch}${os === 'windows' ? '.zip' : '.tar.gz'}`;
}

function assetShape(asset, version) {
  invariant(asset && typeof asset === 'object' && !Array.isArray(asset), 'invalid manifest asset');
  invariant(
    typeof asset.os === 'string' && typeof asset.arch === 'string',
    'invalid manifest asset target',
  );
  invariant(knownTarget(asset.os, asset.arch), `unsupported target: ${asset.os}/${asset.arch}`);
  invariant(
    typeof asset.file === 'string' && asset.file === archiveFilename(version, asset.os, asset.arch),
    `invalid asset file: ${String(asset.file)}`,
  );
  invariant(
    typeof asset.sha256 === 'string' && sha256.test(asset.sha256),
    `invalid asset sha256: ${String(asset.sha256)}`,
  );
}

export function validateManifest(manifest) {
  invariant(
    manifest && typeof manifest === 'object' && !Array.isArray(manifest),
    'invalid manifest',
  );
  invariant(manifest.schemaVersion === 1, 'unsupported manifest schema version');
  const version = validVersion(manifest.version, 'manifest version');
  validVersion(manifest.nodeVersion, 'manifest nodeVersion');
  invariant(
    manifest.repository === REPOSITORY,
    `invalid repository: ${String(manifest.repository)}`,
  );
  invariant(
    Array.isArray(manifest.assets) && manifest.assets.length === EXPECTED_TARGETS.length,
    'manifest must have exactly six assets',
  );
  const seen = new Set();
  for (const asset of manifest.assets) {
    assetShape(asset, version);
    const key = targetKey(asset.os, asset.arch);
    invariant(!seen.has(key), `duplicate manifest target: ${key}`);
    seen.add(key);
  }
  for (const target of EXPECTED_TARGETS) {
    invariant(
      seen.has(targetKey(target.os, target.arch)),
      `missing manifest target: ${targetKey(target.os, target.arch)}`,
    );
  }
  return manifest;
}

function sortedAssets(assets) {
  return [...assets].sort((left, right) =>
    targetKey(left.os, left.arch).localeCompare(targetKey(right.os, right.arch)),
  );
}

export function serializeManifest(manifest) {
  validateManifest(manifest);
  return `${JSON.stringify({ ...manifest, assets: sortedAssets(manifest.assets) }, null, 2)}\n`;
}

async function parseSidecar(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `invalid archive sidecar ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function createManifestFromDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const archives = entries
    .filter(
      (entry) => entry.isFile() && (entry.name.endsWith('.tar.gz') || entry.name.endsWith('.zip')),
    )
    .map((entry) => entry.name)
    .sort();
  invariant(
    archives.length === EXPECTED_TARGETS.length,
    `expected exactly six archives, found ${archives.length}`,
  );
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const expectedSidecars = new Set(archives.map((file) => `${file}.json`));
  for (const file of files) {
    if (/\.(?:tar\.gz|zip)\.json$/.test(file) && !expectedSidecars.has(file)) {
      throw new Error(`orphan archive sidecar: ${file}`);
    }
  }
  const assets = [];
  let version;
  let nodeVersion;
  for (const file of archives) {
    invariant(!file.includes('/') && !file.includes('\\'), `unsafe archive file: ${file}`);
    const sidecarName = `${file}.json`;
    invariant(files.has(sidecarName), `missing archive sidecar: ${sidecarName}`);
    const metadata = await parseSidecar(path.join(directory, sidecarName));
    invariant(
      metadata && typeof metadata === 'object' && !Array.isArray(metadata),
      `invalid archive sidecar: ${sidecarName}`,
    );
    validVersion(metadata.version, 'archive version');
    validVersion(metadata.nodeVersion, 'archive nodeVersion');
    invariant(
      typeof metadata.os === 'string' && typeof metadata.arch === 'string',
      `invalid archive target: ${sidecarName}`,
    );
    invariant(
      knownTarget(metadata.os, metadata.arch),
      `unsupported archive target: ${metadata.os}/${metadata.arch}`,
    );
    invariant(metadata.file === file, `archive sidecar file mismatch: ${sidecarName}`);
    invariant(
      file === archiveFilename(metadata.version, metadata.os, metadata.arch),
      `archive filename does not match sidecar target: ${file}`,
    );
    invariant(
      typeof metadata.sha256 === 'string' && sha256.test(metadata.sha256),
      `invalid archive sha256: ${sidecarName}`,
    );
    const actualHash = createHash('sha256')
      .update(await readFile(path.join(directory, file)))
      .digest('hex');
    invariant(actualHash === metadata.sha256, `archive sha256 mismatch: ${file}`);
    if (version === undefined) version = metadata.version;
    if (nodeVersion === undefined) nodeVersion = metadata.nodeVersion;
    invariant(version === metadata.version, 'archive versions differ');
    invariant(nodeVersion === metadata.nodeVersion, 'archive node versions differ');
    assets.push({ os: metadata.os, arch: metadata.arch, file, sha256: actualHash });
  }
  return validateManifest({
    schemaVersion: 1,
    version,
    nodeVersion,
    repository: REPOSITORY,
    assets: sortedAssets(assets),
  });
}

export async function writeManifest(directory, manifest) {
  const body = serializeManifest(manifest);
  const checksums = `${sortedAssets(manifest.assets)
    .map((asset) => `${asset.sha256}  ${asset.file}`)
    .join('\n')}\n`;
  const manifestPath = path.join(directory, 'release-manifest.json');
  const checksumsPath = path.join(directory, 'checksums.txt');
  await Promise.all([writeFile(manifestPath, body), writeFile(checksumsPath, checksums)]);
  return { manifestPath, checksumsPath };
}

async function main(argv) {
  if (argv.length !== 1)
    throw new Error('usage: node scripts/release/manifest.mjs <artifacts-dir>');
  await writeManifest(argv[0], await createManifestFromDirectory(argv[0]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
