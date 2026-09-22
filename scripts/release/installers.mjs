import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './manifest.mjs';

function candidateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid installer base URL: ${String(value)}`);
  }
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('installer base URL must use HTTPS or loopback HTTP');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('installer base URL cannot include credentials, query, or fragment');
  }
  return url.href.replace(/\/+$/, '');
}

function asset(manifest, os, arch) {
  const found = manifest.assets.find((entry) => entry.os === os && entry.arch === arch);
  if (!found) throw new Error(`missing manifest asset: ${os}/${arch}`);
  return found;
}

function assetUrl(baseUrl, entry) {
  return `${baseUrl}/${entry.file}`;
}

function rubyAsset(baseUrl, entry, indent) {
  return `${indent}url "${assetUrl(baseUrl, entry)}"\n${indent}sha256 "${entry.sha256}"`;
}

export function installerBaseUrl(manifest, baseUrl) {
  validateManifest(manifest);
  return baseUrl === undefined
    ? `https://github.com/${manifest.repository}/releases/download/v${manifest.version}`
    : candidateUrl(baseUrl);
}

export function createInstallerFiles(manifest, { baseUrl } = {}) {
  validateManifest(manifest);
  const root = installerBaseUrl(manifest, baseUrl);
  const windowsAmd64 = asset(manifest, 'windows', 'amd64');
  const windowsArm64 = asset(manifest, 'windows', 'arm64');
  const scoop = {
    version: manifest.version,
    description: 'Jev command-line interface',
    homepage: `https://github.com/${manifest.repository}`,
    license: 'Apache-2.0',
    architecture: {
      '64bit': { url: assetUrl(root, windowsAmd64), hash: windowsAmd64.sha256, bin: 'jev.exe' },
      arm64: { url: assetUrl(root, windowsArm64), hash: windowsArm64.sha256, bin: 'jev.exe' },
    },
  };
  const formula = `class Jev < Formula
  desc "Command-line interface for working with Jev question sets"
  homepage "https://github.com/${manifest.repository}"
  version "${manifest.version}"
  license "Apache-2.0"

  on_macos do
    on_arm do
${rubyAsset(root, asset(manifest, 'darwin', 'arm64'), '      ')}
    end
    on_intel do
${rubyAsset(root, asset(manifest, 'darwin', 'amd64'), '      ')}
    end
  end

  on_linux do
    on_arm do
${rubyAsset(root, asset(manifest, 'linux', 'arm64'), '      ')}
    end
    on_intel do
${rubyAsset(root, asset(manifest, 'linux', 'amd64'), '      ')}
    end
  end

  def install
    bin.install "jev"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/jev --version")
    assert_match "Usage:", shell_output("#{bin}/jev --help")
  end
end
`;
  return { scoop: `${JSON.stringify(scoop, null, 2)}\n`, formula };
}

export async function writeInstallers(manifest, outputDirectory, options) {
  const files = createInstallerFiles(manifest, options);
  const formulaDirectory = path.join(outputDirectory, 'Formula');
  await mkdir(formulaDirectory, { recursive: true });
  const scoopPath = path.join(outputDirectory, 'jev.json');
  const formulaPath = path.join(formulaDirectory, 'jev.rb');
  await Promise.all([writeFile(scoopPath, files.scoop), writeFile(formulaPath, files.formula)]);
  return { scoopPath, formulaPath };
}

async function main(argv) {
  const [manifestPath, outputDirectory, ...options] = argv;
  if (
    !manifestPath ||
    !outputDirectory ||
    options.length > 2 ||
    (options.length && options[0] !== '--base-url')
  ) {
    throw new Error(
      'usage: node scripts/release/installers.mjs <manifest-path> <output-dir> [--base-url URL]',
    );
  }
  if (options.length === 1 || (options.length === 2 && !options[1])) {
    throw new Error('missing --base-url value');
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeInstallers(
    manifest,
    outputDirectory,
    options.length ? { baseUrl: options[1] } : undefined,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
