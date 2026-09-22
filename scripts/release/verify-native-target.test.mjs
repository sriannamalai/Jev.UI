import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { executableArchitecture, verifyNativeTarget } from './verify-native-target.mjs';

function elf(machine) {
  const binary = Buffer.alloc(20);
  binary.set([0x7f, 0x45, 0x4c, 0x46]);
  binary.writeUInt16LE(machine, 18);
  return binary;
}

function pe(machine) {
  const binary = Buffer.alloc(0x90);
  binary.writeUInt32LE(0x80, 0x3c);
  binary.writeUInt32LE(0x00004550, 0x80);
  binary.writeUInt16LE(machine, 0x84);
  return binary;
}

test('reads ELF and PE machine headers without string escape handling', () => {
  assert.equal(executableArchitecture(elf(0x3e), 'linux'), 'x64');
  assert.equal(executableArchitecture(elf(0xb7), 'linux'), 'arm64');
  assert.equal(executableArchitecture(pe(0x8664), 'win32'), 'x64');
  assert.equal(executableArchitecture(pe(0xaa64), 'win32'), 'arm64');
});

test('rejects an executable whose parsed architecture differs from the target', () => {
  assert.throws(
    () =>
      verifyNativeTarget(pe(0x8664), {
        platform: 'win32',
        arch: 'arm64',
        runtimePlatform: 'win32',
        runtimeArch: 'arm64',
      }),
    /Executable architecture mismatch/,
  );
});

test('matches the locally built Mach-O when running on darwin arm64', async (t) => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    t.skip('requires local darwin arm64');
  const binary = await readFile('dist/release/jev');
  assert.equal(executableArchitecture(binary, 'darwin'), 'arm64');
  assert.doesNotThrow(() => verifyNativeTarget(binary, { platform: 'darwin', arch: 'arm64' }));
});
