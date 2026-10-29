import path from 'node:path';

export function getDataDirectory(): string {
  if (process.env.DOKS_DATA_DIR) return process.env.DOKS_DATA_DIR;
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'Doks', 'data');
  }
  return path.join(process.cwd(), 'data');
}
