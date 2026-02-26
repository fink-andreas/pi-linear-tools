#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const targetDir = join(process.cwd(), '.pi', 'extensions');
const targetFile = join(targetDir, 'pi-linear-tools.js');
const content = "export { default } from '../../extensions/pi-linear-tools.js';\n";

await mkdir(targetDir, { recursive: true });
await writeFile(targetFile, content, 'utf-8');

console.log(`✓ Synced local extension wrapper: ${targetFile}`);
console.log('Next: run /reload (or restart pi) and re-test tools.');
