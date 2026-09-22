export const NODE_VERSION = '24.21.0';

export const TARGETS = [
  { os: 'linux', arch: 'x64', runner: 'ubuntu-26.04', extension: '' },
  { os: 'linux', arch: 'arm64', runner: 'ubuntu-26.04-arm', extension: '' },
  { os: 'darwin', arch: 'x64', runner: 'macos-26-intel', extension: '' },
  { os: 'darwin', arch: 'arm64', runner: 'macos-26', extension: '' },
  { os: 'win32', arch: 'x64', runner: 'windows-2025', extension: '.exe' },
  { os: 'win32', arch: 'arm64', runner: 'windows-11-arm', extension: '.exe' },
];
