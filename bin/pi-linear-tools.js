#!/usr/bin/env node

import { runCli } from '../src/cli.js';

runCli().catch((error) => {
  console.error('pi-linear-tools CLI error:', error?.message || error);
  process.exit(1);
});
