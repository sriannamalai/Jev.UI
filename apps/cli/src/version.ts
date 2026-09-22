import { readFileSync } from 'node:fs';

declare const __JEV_UI_BUILD_VERSION__: string | undefined;

function sourceVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

export const CLI_VERSION =
  typeof __JEV_UI_BUILD_VERSION__ === 'string' ? __JEV_UI_BUILD_VERSION__ : sourceVersion();
