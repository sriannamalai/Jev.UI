import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire, isBuiltin } from 'node:module';
import { build } from 'esbuild';
import { resolvePnpmInvocation, runCommand } from './command-runner.mjs';
import { NODE_VERSION } from './config.mjs';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(new URL('../../apps/cli/package.json', import.meta.url));
const { inject } = require('postject');
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function parseArgs(argv) {
  const index = argv.indexOf('--out-dir');
  if (index === -1 || argv[index + 1] === undefined || argv.length !== 2) {
    throw new Error('usage: node scripts/release/build-binary.mjs --out-dir <directory>');
  }
  return path.resolve(root, argv[index + 1]);
}

function run(command, args, options = {}) {
  return runCommand(command, args, { cwd: root, stdio: 'inherit', ...options });
}

function runPnpm(args) {
  const invocation = resolvePnpmInvocation(args);
  return run(invocation.command, invocation.args);
}

async function filesBelow(directory, prefix) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...(await filesBelow(absolute, name)));
    else if (entry.isFile()) result.push({ name, file: absolute, mode: 0o600 });
  }
  return result;
}

async function gitSha() {
  const chunks = [];
  await new Promise((resolve, reject) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('git rev-parse failed')),
    );
  });
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  if (process.versions.node !== NODE_VERSION) {
    throw new Error(`Node ${NODE_VERSION} is required; running ${process.versions.node}`);
  }

  const outDir = parseArgs(process.argv.slice(2));
  const work = await mkdtemp(path.join(tmpdir(), 'jev-sea-build-'));
  const packageJson = JSON.parse(await readFile(path.join(root, 'apps/cli/package.json'), 'utf8'));
  const extension = process.platform === 'win32' ? '.exe' : '';
  const executable = path.join(outDir, `jev${extension}`);

  try {
    await mkdir(outDir, { recursive: true });
    // Workspace package exports point at dist, so compile every dependency before bundling.
    await runPnpm(['build']);

    const app = path.join(work, 'app.mjs');
    const optionalModules = {
      name: 'optional-modules',
      setup(buildContext) {
        buildContext.onResolve(
          { filter: /^(react-devtools-core|bufferutil|utf-8-validate)$/ },
          (args) => ({
            path: args.path,
            namespace: 'optional-modules',
          }),
        );
        buildContext.onLoad({ filter: /.*/, namespace: 'optional-modules' }, (args) => ({
          contents:
            args.path === 'react-devtools-core'
              ? 'export default { initialize() {}, connectToDevTools() {} };'
              : // ws requires these native accelerators inside try/catch. Throwing preserves
                // its JavaScript fallback; an empty object would install undefined methods.
                `throw new Error(${JSON.stringify(`${args.path} is an optional native accelerator`)});`,
          loader: 'js',
        }));
      },
    };
    const result = await build({
      absWorkingDir: root,
      entryPoints: ['scripts/release/entry.ts'],
      outfile: app,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node24',
      metafile: true,
      plugins: [optionalModules],
      define: {
        __JEV_UI_BUILD_VERSION__: JSON.stringify(packageJson.version),
        __JEV_UI_SEA_BUNDLE__: 'true',
        'process.env.DEV': '"false"',
        'process.env.NODE_ENV': '"production"',
      },
      banner: {
        js: "import { createRequire as __jevCreateRequire } from 'node:module';const require=__jevCreateRequire(import.meta.url);",
      },
    });
    const unexpectedExternal = Object.values(result.metafile.outputs)
      .flatMap((output) => output.imports)
      .filter((item) => item.external && !isBuiltin(item.path));
    if (unexpectedExternal.length > 0) {
      throw new Error(
        `Unbundled dependencies: ${unexpectedExternal.map((item) => item.path).join(', ')}`,
      );
    }
    await writeFile(
      path.join(outDir, 'app-metafile.json'),
      JSON.stringify(result.metafile, null, 2),
    );

    const openEntry = cliRequire.resolve('open');
    const assets = [
      { name: 'app.mjs', file: app, mode: 0o600 },
      { name: 'xdg-open', file: path.join(path.dirname(openEntry), 'xdg-open'), mode: 0o755 },
      ...(await filesBelow(path.join(root, 'apps/web/dist'), 'web')),
    ].sort((a, b) => a.name.localeCompare(b.name));
    const metadata = {
      version: packageJson.version,
      nodeVersion: NODE_VERSION,
      os: process.platform,
      arch: process.arch,
      sha: await gitSha(),
      assets: assets.map(({ name, mode }) => ({ name, mode })),
    };
    const metadataFile = path.join(work, 'build-metadata.json');
    await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);

    const bootstrap = path.join(work, 'sea-bootstrap.cjs');
    await build({
      absWorkingDir: root,
      entryPoints: ['scripts/release/sea-bootstrap.cjs'],
      outfile: bootstrap,
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node24',
    });
    const seaConfig = path.join(work, 'sea-config.json');
    const seaBlob = path.join(work, 'sea-prep.blob');
    await writeFile(
      seaConfig,
      JSON.stringify({
        main: bootstrap,
        output: seaBlob,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
        assets: Object.fromEntries([
          ['build-metadata.json', metadataFile],
          ...assets.map((asset) => [asset.name, asset.file]),
        ]),
      }),
    );
    await run(process.execPath, ['--experimental-sea-config', seaConfig]);
    await cp(process.execPath, executable);

    if (process.platform === 'darwin') {
      await run('codesign', ['--remove-signature', executable]);
    } else if (process.platform === 'win32') {
      try {
        await run('signtool.exe', ['remove', '/s', executable]);
      } catch (error) {
        process.stderr.write(
          `warning: could not remove the Windows signature before injection: ${error.message}\n`,
        );
      }
    }
    await inject(executable, 'NODE_SEA_BLOB', await readFile(seaBlob), {
      sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      machoSegmentName: 'NODE_SEA',
    });
    if (process.platform === 'darwin') {
      await run('codesign', ['--sign', '-', '--force', executable]);
      await run('codesign', ['--verify', '--strict', executable]);
    }

    const binary = await readFile(executable);
    const sidecar = {
      ...metadata,
      binarySha256: createHash('sha256').update(binary).digest('hex'),
      binarySize: (await stat(executable)).size,
    };
    await writeFile(
      path.join(outDir, 'build-metadata.json'),
      `${JSON.stringify(sidecar, null, 2)}\n`,
    );
    process.stdout.write(`${executable}\n`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await main();
