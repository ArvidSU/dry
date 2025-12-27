
export enum LogLevel {
  SILENT = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  VERBOSE = 4,
  DEBUG = 5,
}

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

export class Logger {
  private level: LogLevel = LogLevel.INFO;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  error(message: string, ...args: any[]) {
    if (this.level >= LogLevel.ERROR) {
      console.error(`${COLORS.red}${COLORS.bright}ERROR:${COLORS.reset} ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.level >= LogLevel.WARN) {
      console.warn(`${COLORS.yellow}${COLORS.bright}WARN:${COLORS.reset} ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.level >= LogLevel.INFO) {
      console.log(message, ...args);
    }
  }

  success(message: string, ...args: any[]) {
    if (this.level >= LogLevel.INFO) {
      console.log(`${COLORS.green}${COLORS.bright}SUCCESS:${COLORS.reset} ${message}`, ...args);
    }
  }

  verbose(message: string, ...args: any[]) {
    if (this.level >= LogLevel.VERBOSE) {
      console.log(`${COLORS.dim}${message}${COLORS.reset}`, ...args);
    }
  }

  debug(message: string, ...args: any[]) {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`${COLORS.magenta}[DEBUG]${COLORS.reset} ${message}`, ...args);
    }
  }

  /**
   * Logs a message regardless of level (for essential UI output like search results)
   */
  log(message: string, ...args: any[]) {
    if (this.level !== LogLevel.SILENT) {
      console.log(message, ...args);
    }
  }
}

export const logger = new Logger();

