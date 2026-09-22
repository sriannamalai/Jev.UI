'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Node SEA bootstrap is CommonJS. */

const { getAsset } = require('node:sea');
const { runExtractedApplication } = require('./extract-assets.cjs');

const metadata = JSON.parse(getAsset('build-metadata.json', 'utf8'));

void runExtractedApplication({
  assets: metadata.assets,
  getAsset,
}).catch((error) => {
  process.stderr.write(`jev: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
