import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const machines = {
  linux: { 0x3e: 'x64', 0xb7: 'arm64' },
  win32: { 0x8664: 'x64', 0xaa64: 'arm64' },
  darwin: { 0x01000007: 'x64', 0x0100000c: 'arm64' },
};

export function executableArchitecture(binary, platform) {
  let machine;
  if (platform === 'win32') {
    const pe = binary.readUInt32LE(0x3c);
    if (binary.readUInt32LE(pe) !== 0x00004550) throw new Error('Not a PE executable');
    machine = binary.readUInt16LE(pe + 4);
  } else if (platform === 'linux') {
    if (!binary.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
      throw new Error('Not an ELF executable');
    }
    machine = binary.readUInt16LE(18);
  } else if (platform === 'darwin') {
    machine = binary.readUInt32LE(4);
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  const architecture = machines[platform][machine];
  if (!architecture)
    throw new Error(`Unsupported ${platform} executable machine: 0x${machine.toString(16)}`);
  return architecture;
}

export function verifyNativeTarget(
  binary,
  { platform, arch, runtimePlatform = process.platform, runtimeArch = process.arch },
) {
  if (runtimePlatform !== platform || runtimeArch !== arch) {
    throw new Error(`Runner is ${runtimePlatform}/${runtimeArch}, expected ${platform}/${arch}`);
  }
  const executableArch = executableArchitecture(binary, platform);
  if (executableArch !== arch) {
    throw new Error(`Executable architecture mismatch: ${executableArch}, expected ${arch}`);
  }
}

async function main(argv) {
  if (argv.length !== 3) {
    throw new Error(
      'usage: node scripts/release/verify-native-target.mjs <platform> <arch> <executable>',
    );
  }
  const [platform, arch, executable] = argv;
  verifyNativeTarget(await readFile(executable), { platform, arch });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
