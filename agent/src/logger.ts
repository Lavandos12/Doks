export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLevel: LogLevel = (process.env.DOKS_LOG as LogLevel) || 'info';

export const logger = {
  debug: (...args: any[]) => {
    if (LEVEL_WEIGHT[currentLevel] <= LEVEL_WEIGHT.debug) {
      console.debug('[DEBUG]', ...args);
    }
  },
  info: (...args: any[]) => {
    if (LEVEL_WEIGHT[currentLevel] <= LEVEL_WEIGHT.info) {
      console.log('[INFO]', ...args);
    }
  },
  warn: (...args: any[]) => {
    if (LEVEL_WEIGHT[currentLevel] <= LEVEL_WEIGHT.warn) {
      console.warn('[WARN]', ...args);
    }
  },
  error: (...args: any[]) => {
    if (LEVEL_WEIGHT[currentLevel] <= LEVEL_WEIGHT.error) {
      console.error('[ERROR]', ...args);
    }
  }
};
