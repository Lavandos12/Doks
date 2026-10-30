export * from './types.js';
export * from './schema.js';
export * from './protocol.js';
export * from './canvas.js';
export * from './importers.js';
export * from './ai-context.js';
export {
  type Transport,
  type TransportConnection,
  type TransportConfig,
  type TransportPeerMessage,
  type TransportPeerMessageType
} from './transport.js';

export const isSafeUrl = (url: string): boolean => {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  // Strictly allow http, https, mailto, relative /api/ attachments, or anchors
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('#')
  );
};
