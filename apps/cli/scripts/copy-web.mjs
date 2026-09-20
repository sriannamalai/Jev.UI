#!/usr/bin/env node
// Copies the built web app (`apps/web/dist`) into the cli's own `dist/web`
// so `jev serve` (which resolves `webDir` relative to its own compiled
// `bin.js`) can find it. Run as the last step of the cli's `build` script,
// after `apps/web` has already been built (the root build order guarantees
// this via the `@jev-ui/web` devDependency).
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));
const webIndexHtml = fileURLToPath(new URL('../../web/dist/index.html', import.meta.url));
const destDir = fileURLToPath(new URL('../dist/web', import.meta.url));

if (!existsSync(webIndexHtml)) {
  console.error('web build not found — run pnpm --filter @jev-ui/web build first');
  process.exit(1);
}

rmSync(destDir, { recursive: true, force: true });
cpSync(webDistDir, destDir, { recursive: true });
