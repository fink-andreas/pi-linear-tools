/**
 * Structured logging module
 */

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
let currentLevel = process.env.LOG_LEVEL || 'info';
let quietMode = false;

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
  if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
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
    ...data
  };
  return JSON.stringify(entry);
}

/**
 * Log at debug level
 */
export function debug(message, data = {}) {
  if (shouldLog('debug')) {
    console.log(formatLog('debug', message, data));
  }
}

/**
 * Log at info level
 */
export function info(message, data = {}) {
  if (shouldLog('info')) {
    console.log(formatLog('info', message, data));
  }
}

/**
 * Log at warn level
 */
export function warn(message, data = {}) {
  if (shouldLog('warn')) {
    console.log(formatLog('warn', message, data));
  }
}

/**
 * Log at error level
 */
export function error(message, data = {}) {
  if (shouldLog('error')) {
    console.error(formatLog('error', message, data));
  }
}

/**
 * Print startup banner
 */
export function printBanner() {
  const banner = `
╔════════════════════════════════════════════════════════════╗
║               pi-linear-tools                             ║
║     Pi extension tools for Linear SDK workflows           ║
╚════════════════════════════════════════════════════════════╝
`;
  console.log(banner);
}

/**
 * Log configuration summary (with secrets masked)
 */
export function logConfig(config) {
  info('Configuration loaded', {
    ...Object.fromEntries(
      Object.entries(config).map(([key, value]) => [key, maskValue(key, value)])
    )
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
