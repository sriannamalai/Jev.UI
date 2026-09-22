import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { archiveName, createArchive } from './archive.mjs';

async function writeFixture(root, relative, contents) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  return file;
}

test('archives one native release with its notices and a byte-accurate sidecar', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jev archive test '));
  const binaryDir = path.join(root, 'binary');
  const outputDir = path.join(root, 'artifacts');
  const projectRoot = path.join(root, 'project');
  const fontInputs = ['@fontsource/ibm-plex-sans', '@fontsource/ibm-plex-mono'];

  await Promise.all([
    writeFixture(projectRoot, 'LICENSE', 'Apache-2.0 project license\n'),
    writeFixture(root, 'node/LICENSE', 'Node.js license\n'),
    writeFixture(binaryDir, 'jev', 'native binary bytes\n'),
    writeFixture(
      binaryDir,
      'build-metadata.json',
      `${JSON.stringify({ version: '0.2.0', nodeVersion: '24.21.0', os: 'darwin', arch: 'arm64' })}\n`,
    ),
    ...fontInputs.flatMap((name) => [
      writeFixture(
        projectRoot,
        `node_modules/${name}/package.json`,
        `${JSON.stringify({ name, version: '5.2.8', license: 'OFL-1.1' })}\n`,
      ),
      writeFixture(projectRoot, `node_modules/${name}/LICENSE`, `${name} font license\n`),
      writeFixture(projectRoot, `node_modules/${name}/nested/package.json`, '{"type":"module"}\n'),
      writeFixture(projectRoot, `node_modules/${name}/nested/font.woff2`, 'font bytes'),
    ]),
  ]);
  await writeFixture(
    binaryDir,
    'app-metafile.json',
    `${JSON.stringify({
      inputs: Object.fromEntries(
        fontInputs.map((name) => [
          path.join(projectRoot, 'node_modules', name, 'nested/font.woff2'),
          {},
        ]),
      ),
    })}\n`,
  );
  await Promise.all([
    writeFixture(
      projectRoot,
      'apps/web/package.json',
      `${JSON.stringify({ name: '@jev-ui/web', version: '0.2.0', dependencies: { 'react-dom': '19.2.4', '@codemirror/state': '6.6.0' } })}\n`,
    ),
    writeFixture(
      projectRoot,
      'node_modules/.pnpm/react-dom@19.2.4/node_modules/react-dom/package.json',
      `${JSON.stringify({ name: 'react-dom', version: '19.2.4', license: 'MIT', dependencies: { scheduler: '0.27.0' } })}\n`,
    ),
    writeFixture(
      projectRoot,
      'node_modules/.pnpm/react-dom@19.2.4/node_modules/react-dom/LICENSE',
      'react-dom license\n',
    ),
    writeFixture(
      projectRoot,
      'node_modules/.pnpm/react-dom@19.2.4/node_modules/react-dom/NOTICE',
      'react-dom notice\n',
    ),
    writeFixture(
      projectRoot,
      'node_modules/.pnpm/scheduler@0.27.0/node_modules/scheduler/package.json',
      `${JSON.stringify({ name: 'scheduler', version: '0.27.0', license: 'MIT' })}\n`,
    ),
    writeFixture(
      projectRoot,
      'node_modules/.pnpm/scheduler@0.27.0/node_modules/scheduler/LICENSE',
      'scheduler license\n',
    ),
    writeFixture(
      projectRoot,
      'apps/web/node_modules/@codemirror/state/package.json',
      `${JSON.stringify({ name: '@codemirror/state', version: '6.6.0', license: 'MIT' })}\n`,
    ),
    writeFixture(
      projectRoot,
      'apps/web/node_modules/@codemirror/state/LICENSE',
      'CodeMirror license\n',
    ),
  ]);
  const reactDom = path.join(
    projectRoot,
    'node_modules/.pnpm/react-dom@19.2.4/node_modules/react-dom',
  );
  const scheduler = path.join(
    projectRoot,
    'node_modules/.pnpm/scheduler@0.27.0/node_modules/scheduler',
  );
  await mkdir(path.join(reactDom, 'node_modules'), { recursive: true });
  await symlink(reactDom, path.join(projectRoot, 'apps/web/node_modules/react-dom'), 'dir');
  await symlink(scheduler, path.join(reactDom, 'node_modules/scheduler'), 'dir');

  assert.equal(archiveName('0.2.0', 'windows', 'arm64'), 'jev_0.2.0_windows_arm64.zip');
  const result = await createArchive({
    binaryDir,
    outputDir,
    projectRoot,
    nodeLicensePath: path.join(root, 'node/LICENSE'),
  });

  assert.equal(path.basename(result.archive), 'jev_0.2.0_darwin_arm64.tar.gz');
  assert.deepEqual(JSON.parse(await readFile(result.sidecar, 'utf8')), {
    version: '0.2.0',
    nodeVersion: '24.21.0',
    os: 'darwin',
    arch: 'arm64',
    file: 'jev_0.2.0_darwin_arm64.tar.gz',
    sha256: createHash('sha256')
      .update(await readFile(result.archive))
      .digest('hex'),
  });

  const unpacked = path.join(root, 'unpacked');
  await result.extract(unpacked);
  assert.deepEqual((await readdir(unpacked, { recursive: true })).sort(), [
    'Install.md',
    'LICENSE',
    'ThirdPartyNotices.txt',
    'build-metadata.json',
    'jev',
  ]);
  assert.equal(await readFile(path.join(unpacked, 'jev'), 'utf8'), 'native binary bytes\n');
  assert.match(
    await readFile(path.join(unpacked, 'ThirdPartyNotices.txt'), 'utf8'),
    /Node\.js license/,
  );
  assert.match(
    await readFile(path.join(unpacked, 'ThirdPartyNotices.txt'), 'utf8'),
    /@fontsource\/ibm-plex-sans font license/,
  );
  const notices = await readFile(path.join(unpacked, 'ThirdPartyNotices.txt'), 'utf8');
  assert.match(notices, /react-dom license/);
  assert.match(notices, /react-dom notice/);
  assert.match(notices, /CodeMirror license/);
  assert.match(notices, /scheduler license/);
});
