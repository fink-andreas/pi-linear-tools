/**
 * Shared utilities for pi-linear-tools entry points
 *
 * Common functions used by both CLI and extension entry points.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Check if a directory is a pi-coding-agent root
 * @param {string} dir - Directory path to check
 * @returns {boolean}
 */
export function isPiCodingAgentRoot(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg?.name === '@mariozechner/pi-coding-agent' || pkg?.name === '@earendil-works/pi-coding-agent';
  } catch {
    return false;
  }
}

/**
 * Find the pi-coding-agent root directory
 * @returns {string|null}
 */
export function findPiCodingAgentRoot() {
  const entry = process.argv?.[1];
  if (!entry) return null;

  // Method 1: walk up from argv1 (works when argv1 is .../pi-coding-agent/dist/cli.js)
  {
    let dir = path.dirname(entry);
    for (let i = 0; i < 20; i += 1) {
      if (isPiCodingAgentRoot(dir)) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // Method 2: npm global layout guess (works when argv1 is .../<prefix>/bin/pi)
  // <prefix>/bin/pi  ->  <prefix>/lib/node_modules/@mariozechner/pi-coding-agent
  {
    const binDir = path.dirname(entry);
    const prefix = path.resolve(binDir, '..');
    for (const scope of ['@mariozechner', '@earendil-works']) {
      const candidate = path.join(prefix, 'lib', 'node_modules', scope, 'pi-coding-agent');
      if (isPiCodingAgentRoot(candidate)) {
        return candidate;
      }
    }
  }

  // Method 3: common global node_modules locations
  for (const candidate of [
    '/usr/local/lib/node_modules/@mariozechner/pi-coding-agent',
    '/usr/lib/node_modules/@mariozechner/pi-coding-agent',
    '/usr/local/lib/node_modules/@earendil-works/pi-coding-agent',
    '/usr/lib/node_modules/@earendil-works/pi-coding-agent',
    '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent',
  ]) {
    if (isPiCodingAgentRoot(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Import from pi-coding-agent root
 * @param {string} relativePathFromPiRoot - Path relative to pi root
 * @returns {Promise<any>}
 */
export async function importFromPiRoot(relativePathFromPiRoot) {
  const piRoot = findPiCodingAgentRoot();

  if (!piRoot) throw new Error('Unable to locate @mariozechner/pi-coding-agent installation');

  const absPath = path.join(piRoot, relativePathFromPiRoot);
  return import(pathToFileURL(absPath).href);
}

/**
 * Parse command line arguments string into tokens
 * @param {string} argsString - Arguments string to parse
 * @returns {string[]}
 */
export function parseArgs(argsString) {
  if (!argsString || !argsString.trim()) return [];
  const tokens = argsString.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return tokens.map((t) => {
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1);
    }
    return t;
  });
}

/**
 * Read a flag value from command line arguments
 * @param {string[]} args - Parsed arguments
 * @param {string} flag - Flag name
 * @returns {string|undefined}
 */
export function readFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

let cachedDefaultProject;

/**
 * Resolve the default Linear project name when a handler receives no explicit
 * `project` argument.
 *
 * Prefers the repository name derived from the origin git remote (stable in a
 * worktree, subdirectory, or bare checkout), and falls back to the current
 * directory's basename when no remote is resolvable -- the former cwd default.
 *
 * @returns {string}
 */
export function resolveDefaultProject() {
  if (cachedDefaultProject !== undefined) return cachedDefaultProject;
  cachedDefaultProject = getRemoteRepoName() || path.basename(process.cwd());
  return cachedDefaultProject;
}

function getRemoteRepoName() {
  let remoteUrl;
  try {
    remoteUrl = String(execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' })).trim();
  } catch {
    // Not a git repo, or no origin remote is configured. Fall back to cwd.
    return null;
  }

  if (!remoteUrl) return null;
  const firstLine = remoteUrl.split('\n')[0].trim();
  return repoNameFromRemoteUrl(firstLine);
}

function repoNameFromRemoteUrl(remoteUrl) {
  if (!remoteUrl) return null;
  // Drop a URL scheme (https://, git@..., ...) and keep the path portion.
  const rest = remoteUrl.replace(/^[a-z]+:\/\//i, '');
  const segments = rest.split(/[\/:]/).filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return null;
  return last.replace(/\.git$/i, '').replace(/^[\\/]+/, '') || null;
}
