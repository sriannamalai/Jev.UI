import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './command-runner.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const requiredFontPackages = new Set(['@fontsource/ibm-plex-mono', '@fontsource/ibm-plex-sans']);

function targetOs(os) {
  return { win32: 'windows' }[os] ?? os;
}

function targetArch(arch) {
  return arch === 'x64' ? 'amd64' : arch;
}

function checkedTarget(value, label) {
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(value)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return value;
}

export function archiveName(version, os, arch) {
  checkedTarget(version, 'version');
  checkedTarget(os, 'os');
  checkedTarget(arch, 'arch');
  return `jev_${version}_${os}_${arch}${os === 'windows' ? '.zip' : '.tar.gz'}`;
}

function run(command, args) {
  return runCommand(command, args, { stdio: 'inherit', timeout: 300_000 });
}

async function existingFile(candidate) {
  try {
    return (await stat(candidate)).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

async function nodeLicense(defaultPath) {
  if (defaultPath) {
    const found = await existingFile(defaultPath);
    if (found) return found;
    throw new Error(`Node license is missing: ${defaultPath}`);
  }
  const nodeDirectory = path.dirname(process.execPath);
  for (const candidate of [
    path.resolve(nodeDirectory, '../LICENSE'),
    path.join(nodeDirectory, 'LICENSE'),
  ]) {
    const found = await existingFile(candidate);
    if (found) return found;
  }
  throw new Error(`Node license is missing beside ${process.execPath}`);
}

async function packageDirectory(input, projectRoot) {
  let directory = path.dirname(path.resolve(projectRoot, input));
  const stop = path.parse(directory).root;
  while (directory !== stop) {
    if (directory.split(path.sep).includes('node_modules')) {
      const packageFile = await existingFile(path.join(directory, 'package.json'));
      if (packageFile) {
        const metadata = JSON.parse(await readFile(packageFile, 'utf8'));
        if (typeof metadata.name === 'string' && typeof metadata.version === 'string')
          return directory;
      }
    }
    directory = path.dirname(directory);
  }
  return undefined;
}

async function licenseFiles(packageRoot) {
  const entries = await readdir(packageRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^(license|copying|notice)(?:[._-].*)?$/i.test(entry.name))
    .map((entry) => path.join(packageRoot, entry.name))
    .sort();
}

async function bundledPackages(metafile, projectRoot) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs ?? {})) {
    const directory = await packageDirectory(input, projectRoot);
    if (!directory || packages.has(directory)) continue;
    const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    if (typeof metadata.name !== 'string' || typeof metadata.version !== 'string') {
      throw new Error(`invalid package metadata: ${directory}`);
    }
    packages.set(directory, { directory, metadata, licenses: await licenseFiles(directory) });
  }
  for (const packageName of requiredFontPackages) {
    const candidates = [path.join(projectRoot, 'node_modules', packageName)];
    try {
      candidates.push(path.dirname(webRequire.resolve(`${packageName}/package.json`)));
    } catch {
      // The required-package check below reports an actionable error.
    }
    for (const directory of candidates) {
      const packageFile = await existingFile(path.join(directory, 'package.json'));
      if (!packageFile) continue;
      const metadata = JSON.parse(await readFile(packageFile, 'utf8'));
      packages.set(directory, { directory, metadata, licenses: await licenseFiles(directory) });
      break;
    }
  }
  return [...packages.values()].sort((left, right) =>
    left.metadata.name.localeCompare(right.metadata.name),
  );
}

async function packageAt(directory) {
  let canonicalDirectory;
  try {
    canonicalDirectory = await realpath(directory);
  } catch {
    return undefined;
  }
  const packageFile = await existingFile(path.join(canonicalDirectory, 'package.json'));
  if (!packageFile) return undefined;
  const metadata = JSON.parse(await readFile(packageFile, 'utf8'));
  if (typeof metadata.name !== 'string' || typeof metadata.version !== 'string') return undefined;
  return {
    directory: path.dirname(await realpath(packageFile)),
    metadata,
    licenses: await licenseFiles(canonicalDirectory),
  };
}

async function resolveWebDependency(packageName, parent, projectRoot) {
  const candidates = [
    path.join(parent.directory, 'node_modules', packageName),
    path.join(projectRoot, 'apps/web/node_modules', packageName),
    path.join(projectRoot, 'node_modules', packageName),
  ];
  for (const candidate of candidates) {
    const found = await packageAt(candidate);
    if (found) return found;
  }
  try {
    const resolver = createRequire(path.join(parent.directory, 'package.json'));
    const resolved = resolver.resolve(packageName);
    const directory = await packageDirectory(resolved, projectRoot);
    return directory ? packageAt(directory) : undefined;
  } catch {
    return undefined;
  }
}

async function webRuntimePackages(projectRoot) {
  const webPackage = await packageAt(path.join(projectRoot, 'apps/web'));
  if (!webPackage) return [];
  const packages = new Map();
  const queue = Object.keys(webPackage.metadata.dependencies ?? {})
    .sort()
    .map((name) => ({ name, parent: webPackage }));
  while (queue.length > 0) {
    const { name, parent } = queue.shift();
    const dependency = await resolveWebDependency(name, parent, projectRoot);
    if (!dependency) {
      throw new Error(
        `unable to resolve web production dependency ${name} from ${parent.metadata.name}`,
      );
    }
    if (packages.has(dependency.directory)) continue;
    packages.set(dependency.directory, dependency);
    for (const child of [
      ...Object.keys(dependency.metadata.dependencies ?? {}),
      ...Object.keys(dependency.metadata.optionalDependencies ?? {}),
    ].sort()) {
      queue.push({ name: child, parent: dependency });
    }
  }
  return [...packages.values()].sort((left, right) =>
    left.directory.localeCompare(right.directory),
  );
}

async function writeNotices({ archiveRoot, projectRoot, metafile, nodeLicensePath }) {
  const projectLicense = await existingFile(path.join(projectRoot, 'LICENSE'));
  if (!projectLicense) throw new Error(`project license is missing: ${projectRoot}/LICENSE`);

  await copyFile(projectLicense, path.join(archiveRoot, 'LICENSE'));

  const packagesByDirectory = new Map(
    (await bundledPackages(metafile, projectRoot)).map((item) => [item.directory, item]),
  );
  for (const dependency of await webRuntimePackages(projectRoot)) {
    packagesByDirectory.set(dependency.directory, dependency);
  }
  const packages = [...packagesByDirectory.values()].sort((left, right) =>
    left.metadata.name.localeCompare(right.metadata.name),
  );
  const bundledNames = new Set(packages.map(({ metadata }) => metadata.name));
  for (const packageName of requiredFontPackages) {
    if (!bundledNames.has(packageName)) {
      throw new Error(`required bundled font notice is missing from metafile: ${packageName}`);
    }
  }
  const noticeSections = [
    ['Node.js runtime', await readFile(await nodeLicense(nodeLicensePath), 'utf8')],
  ];
  for (const { metadata, licenses } of packages) {
    if (requiredFontPackages.has(metadata.name) && licenses.length === 0) {
      throw new Error(`required bundled font license is missing: ${metadata.name}`);
    }
    noticeSections.push([
      `${metadata.name}@${metadata.version} (${metadata.license ?? 'license metadata unavailable'})`,
      licenses.length > 0
        ? (await Promise.all(licenses.map((license) => readFile(license, 'utf8')))).join('\n\n')
        : 'No license text was distributed with this package.',
    ]);
  }
  const lines = [
    'Jev.UI third-party notices',
    '',
    'The following bundled packages are identified from the release metafile.',
    '',
    ...noticeSections.flatMap(([title, text]) => [
      title,
      '='.repeat(title.length),
      text.trimEnd(),
      '',
    ]),
    '',
  ];
  await writeFile(path.join(archiveRoot, 'ThirdPartyNotices.txt'), lines.join('\n'));
  return packages.length;
}

function installationInstructions(os, arch) {
  const executable = os === 'windows' ? 'jev.exe' : 'jev';
  return [
    `Jev.UI ${os}/${arch}`,
    '',
    `Run ./${executable} --help from this directory.`,
    'Move this directory to a location of your choice, or add it to PATH.',
    '',
  ].join('\n');
}

async function createNativeArchive(archive, stage, os) {
  if (os === 'windows') {
    await run('tar', ['-a', '-c', '-f', archive, '-C', stage, '.']);
    return;
  }
  await run('tar', ['-c', '-z', '-f', archive, '-C', stage, '.']);
}

export async function extractArchive(archive, destination) {
  await mkdir(destination, { recursive: true });
  await run('tar', ['-x', '-f', archive, '-C', destination]);
}

export async function createArchive({ binaryDir, outputDir, projectRoot = root, nodeLicensePath }) {
  const resolvedBinaryDir = path.resolve(binaryDir);
  const metadata = JSON.parse(
    await readFile(path.join(resolvedBinaryDir, 'build-metadata.json'), 'utf8'),
  );
  const os = targetOs(checkedTarget(metadata.os, 'metadata os'));
  const arch = targetArch(checkedTarget(metadata.arch, 'metadata arch'));
  const version = checkedTarget(metadata.version, 'metadata version');
  if (typeof metadata.nodeVersion !== 'string') throw new Error('metadata nodeVersion is required');
  const executable = path.join(resolvedBinaryDir, `jev${metadata.os === 'win32' ? '.exe' : ''}`);
  if (!(await existingFile(executable)))
    throw new Error(`release executable is missing: ${executable}`);
  const metafile = JSON.parse(
    await readFile(path.join(resolvedBinaryDir, 'app-metafile.json'), 'utf8'),
  );
  const file = archiveName(version, os, arch);
  const archive = path.join(path.resolve(outputDir), file);
  const sidecar = `${archive}.json`;
  const stage = await mkdtemp(path.join(tmpdir(), 'jev-native-archive-'));

  try {
    const stagedRoot = path.join(stage, 'release');
    await mkdir(stagedRoot, { recursive: true });
    await Promise.all([
      copyFile(executable, path.join(stagedRoot, path.basename(executable))),
      copyFile(
        path.join(resolvedBinaryDir, 'build-metadata.json'),
        path.join(stagedRoot, 'build-metadata.json'),
      ),
    ]);
    if (metadata.os !== 'win32') await chmod(path.join(stagedRoot, 'jev'), 0o755);
    const noticePackageCount = await writeNotices({
      archiveRoot: stagedRoot,
      projectRoot: path.resolve(projectRoot),
      metafile,
      nodeLicensePath,
    });
    await writeFile(path.join(stagedRoot, 'Install.md'), installationInstructions(os, arch));
    await mkdir(path.dirname(archive), { recursive: true });
    await createNativeArchive(archive, stagedRoot, os);
    const sha256 = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    await writeFile(
      sidecar,
      `${JSON.stringify({ version, nodeVersion: metadata.nodeVersion, os, arch, file, sha256 }, null, 2)}\n`,
    );
    return {
      archive,
      sidecar,
      noticePackageCount,
      extract: (destination) => extractArchive(archive, destination),
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function main(argv) {
  if (argv.length !== 2) {
    throw new Error('usage: node scripts/release/archive.mjs <binary-dir> <output-dir>');
  }
  const result = await createArchive({ binaryDir: argv[0], outputDir: argv[1] });
  process.stdout.write(`${result.archive}\n${result.sidecar}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
