/**
 * Structured logging module (file-first, TUI-safe)
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
let currentLevel = process.env.LOG_LEVEL || 'info';
let quietMode = false;

const LOG_TO_CONSOLE = String(process.env.PI_LINEAR_TOOLS_LOG_TO_CONSOLE || '').toLowerCase() === 'true';
const DEFAULT_LOG_FILE = process.env.PI_LINEAR_TOOLS_LOG_FILE
  || join(process.env.HOME || process.cwd(), '.config', 'pi-linear-tools', 'pi-linear-tools.log');

let logFileReady = false;
let logFilePath = DEFAULT_LOG_FILE;

function ensureLogFileReady() {
  if (logFileReady) return;
  try {
    mkdirSync(dirname(logFilePath), { recursive: true });
  } catch {
    // ignore; fallback handled in writeLogLine
  }
  logFileReady = true;
}

function writeLogLine(line, isError = false) {
  try {
    ensureLogFileReady();
    appendFileSync(logFilePath, `${line}\n`, { encoding: 'utf8' });
  } catch {
    // Last-resort fallback is disabled by default to protect TUI.
    // Only print when explicitly opted in.
    if (LOG_TO_CONSOLE) {
      if (isError) console.error(line);
      else console.log(line);
    }
  }

  if (LOG_TO_CONSOLE) {
    if (isError) console.error(line);
    else console.log(line);
  }
}

/**
 * Enable quiet mode (suppress info/debug/warn, keep only errors)
 */
export function setQuietMode(quiet) {
  quietMode = quiet;
}

/**
 * Check if a log level should be displayed
 */
function shouldLog(level) {
  if (quietMode && level !== 'error') return false;
  const currentIndex = LOG_LEVELS.indexOf(currentLevel);
  const levelIndex = LOG_LEVELS.indexOf(level);
  return levelIndex >= currentIndex;
}

/**
 * Format timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Mask sensitive values in logs
 */
function maskValue(key, value) {
  const sensitiveKeys = ['apiKey', 'token', 'password', 'secret', 'LINEAR_API_KEY'];
  if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
    return '***masked***';
  }
  return value;
}

/**
 * Format log entry
 */
function formatLog(level, message, data = {}) {
  const timestamp = getTimestamp();
  const entry = {
    timestamp,
    level: level.toUpperCase(),
    message,
    ...data,
  };
  return JSON.stringify(entry);
}

/**
 * Log at debug level
 */
export function debug(message, data = {}) {
  if (shouldLog('debug')) {
    writeLogLine(formatLog('debug', message, data));
  }
}

/**
 * Log at info level
 */
export function info(message, data = {}) {
  if (shouldLog('info')) {
    writeLogLine(formatLog('info', message, data));
  }
}

/**
 * Log at warn level
 */
export function warn(message, data = {}) {
  if (shouldLog('warn')) {
    writeLogLine(formatLog('warn', message, data));
  }
}

/**
 * Log at error level
 */
export function error(message, data = {}) {
  if (shouldLog('error')) {
    writeLogLine(formatLog('error', message, data), true);
  }
}

/**
 * Print startup banner
 */
export function printBanner() {
  info('pi-linear-tools startup');
}

/**
 * Log configuration summary (with secrets masked)
 */
export function logConfig(config) {
  info('Configuration loaded', {
    ...Object.fromEntries(
      Object.entries(config).map(([key, value]) => [key, maskValue(key, value)]),
    ),
  });
}

/**
 * Set log level
 */
export function setLogLevel(level) {
  if (LOG_LEVELS.includes(level)) {
    currentLevel = level;
    info(`Log level set to: ${level}`);
  } else {
    warn(`Invalid log level: ${level}. Using: ${currentLevel}`);
  }
}

/**
 * Expose active log file path for diagnostics/tests
 */
export function getLogFilePath() {
  return logFilePath;
}
