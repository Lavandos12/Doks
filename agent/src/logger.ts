export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function getEnvLevel(): LogLevel {
  const env = (process.env.DOKS_LOG || 'info').toLowerCase();
  if (env in LEVEL_WEIGHT) return env as LogLevel;
  return 'info';
}

export class Logger {
  private module: string;

  constructor(module = 'Doks') {
    this.module = module;
  }

  private format(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] [${this.module}] ${message}`;
  }

  public debug(message: string, ...args: any[]): void {
    if (LEVEL_WEIGHT[getEnvLevel()] <= LEVEL_WEIGHT.debug) {
      console.debug(this.format('debug', message), ...args);
    }
  }

  public info(message: string, ...args: any[]): void {
    if (LEVEL_WEIGHT[getEnvLevel()] <= LEVEL_WEIGHT.info) {
      console.log(this.format('info', message), ...args);
    }
  }

  public warn(message: string, ...args: any[]): void {
    if (LEVEL_WEIGHT[getEnvLevel()] <= LEVEL_WEIGHT.warn) {
      console.warn(this.format('warn', message), ...args);
    }
  }

  public error(message: string, ...args: any[]): void {
    if (LEVEL_WEIGHT[getEnvLevel()] <= LEVEL_WEIGHT.error) {
      console.error(this.format('error', message), ...args);
    }
  }

  public forModule(moduleName: string): Logger {
    return new Logger(moduleName);
  }
}

export const logger = new Logger('Doks');
export function createLogger(moduleName: string): Logger {
  return new Logger(moduleName);
}
