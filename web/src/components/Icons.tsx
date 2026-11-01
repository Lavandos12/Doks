import { h, VNode } from 'preact';

export interface IconProps {
  size?: number;
  class?: string;
  className?: string;
  color?: string;
  strokeWidth?: number;
  style?: any;
}

export type IconName =
  // Tools
  | 'select'
  | 'hand'
  | 'sticky'
  | 'sticky-note'
  | 'text'
  | 'type'
  | 'frame'
  | 'shape'
  | 'arrow'
  | 'arrow-right'
  | 'arrow-down'
  | 'arrow-up'
  | 'note-card'
  | 'attachment'
  | 'paperclip'
  // Scopes & Network
  | 'lock'
  | 'globe-mesh'
  | 'wifi'
  | 'wifi-off'
  | 'smartphone'
  | 'monitor'
  | 'network'
  | 'refresh'
  | 'key'
  | 'users'
  | 'promote'
  | 'fork'
  // Workspace & Views
  | 'layout-canvas'
  | 'layout-split'
  | 'split'
  | 'layout-doc'
  | 'sidebar-left'
  | 'minimap'
  | 'grid'
  | 'zoom-in'
  | 'zoom-out'
  | 'grip-vertical'
  | 'maximize'
  | 'minimize'
  // Actions & Files
  | 'plus'
  | 'minus'
  | 'folder'
  | 'folder-open'
  | 'folder-plus'
  | 'file'
  | 'file-text'
  | 'file-code'
  | 'image'
  | 'film'
  | 'music'
  | 'archive'
  | 'search'
  | 'command'
  | 'trash'
  | 'restore'
  | 'history'
  | 'download'
  | 'upload'
  | 'cpu'
  | 'check'
  | 'check-square'
  | 'x'
  | 'more-horizontal'
  | 'more-vertical'
  | 'chevron-right'
  | 'chevron-down'
  | 'copy'
  | 'edit'
  | 'lock-node'
  | 'unlock-node'
  | 'layers'
  | 'alert-triangle'
  | 'info'
  | 'sparkles'
  | 'pin'
  | 'link'
  | 'eye'
  | 'layout'
  | 'columns'
  | 'sun'
  | 'moon'
  | 'move'
  | 'square'
  | 'circle'
  | 'diamond'
  | 'triangle'
  | 'parallelogram'
  | 'cylinder'
  | 'hexagon'
  | 'share'
  | 'settings'
  | 'menu'
  | 'undo'
  | 'redo'
  | 'rotate-ccw'
  | 'rotate-cw'
  | 'pen'
  | 'brush'
  | 'eraser'
  | 'thumbs-up'
  | 'table'
  | 'kanban'
  | 'code'
  | 'checklist'
  | 'chart'
  | 'bar-chart'
  | 'pie-chart'
  | 'doks-cat';

export function Icon({
  name,
  size = 18,
  class: cls = '',
  className = '',
  color = 'currentColor',
  strokeWidth = 1.75,
  style
}: IconProps & { name: IconName }): VNode {
  if (name === 'doks-cat') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        className={`doks-icon ${cls} ${className}`.trim()}
        style={{ flexShrink: 0, borderRadius: 7, boxShadow: '0 2px 8px rgba(109, 40, 217, 0.45)', ...style }}
        aria-hidden="true"
      >
        {/* Deep violet rounded rectangle */}
        <rect width="100" height="100" rx="22" fill="#6D28D9" />
        {/* White cat head silhouette */}
        <path
          fill="#FFFFFF"
          d="M13.7 18.0 Q13.1 19.1 12.7 20.5 Q12.3 21.9 12.1 23.4 Q11.8 24.9 11.8 26.9 Q11.7 28.9 12.2 32.7 Q12.8 36.5 13.5 38.9 Q14.2 41.3 15.1 43.5 Q16.0 45.7 16.0 46.0 Q16.0 46.3 15.5 47.7 Q14.9 49.1 14.3 50.9 Q13.8 52.7 13.4 55.0 Q13.0 57.3 12.7 60.8 Q12.4 64.4 11.6 66.7 Q10.8 69.0 12.1 71.0 Q13.3 73.0 15.0 74.6 Q16.7 76.2 18.0 77.1 Q19.3 78.0 21.1 78.9 Q23.0 79.9 25.6 80.8 Q28.2 81.7 30.7 82.3 Q33.1 82.9 35.4 83.3 Q37.6 83.6 41.0 83.9 Q44.4 84.2 50.9 84.1 Q57.5 84.1 61.8 83.5 Q66.2 83.0 68.5 82.5 Q70.8 82.0 73.0 81.3 Q75.2 80.6 77.5 79.5 Q79.7 78.5 80.8 77.8 Q81.9 77.2 83.1 76.2 Q84.4 75.2 85.8 73.7 Q87.1 72.2 87.9 71.1 Q88.6 69.9 88.9 69.2 Q89.1 68.5 88.6 67.6 Q88.2 66.7 87.8 65.5 Q87.5 64.3 87.0 59.5 Q86.5 54.8 86.1 52.8 Q85.6 50.8 84.7 48.3 Q83.8 45.8 84.7 43.9 Q85.5 42.0 86.4 39.1 Q87.2 36.1 87.6 33.4 Q88.1 30.8 88.1 28.7 Q88.2 26.6 88.0 24.8 Q87.8 23.0 87.5 21.5 Q87.1 20.0 86.5 18.7 Q85.9 17.3 85.4 16.7 Q84.8 16.0 84.3 15.8 Q83.7 15.6 83.1 15.6 Q82.4 15.7 80.1 16.7 Q77.8 17.7 75.1 19.4 Q72.4 21.2 68.4 24.4 Q64.4 27.6 61.2 26.6 Q58.1 25.6 55.0 25.2 Q52.0 24.8 49.9 24.8 Q47.9 24.8 45.7 25.1 Q43.6 25.3 41.5 25.8 Q39.5 26.2 37.5 26.9 Q35.5 27.6 31.4 24.4 Q27.4 21.1 24.4 19.1 Q21.3 17.2 20.3 16.7 Q19.3 16.3 18.0 15.9 Q16.7 15.6 16.1 15.7 Q15.5 15.8 14.9 16.3 Q14.3 16.9 13.7 18.0Z"
        />
        {/* Violet cutouts for eyes and ears */}
        <path
          fill="#6D28D9"
          d="M76.3 63.5 Q76.5 63.8 76.3 64.6 Q76.2 65.3 75.6 66.0 Q75.1 66.7 74.6 67.0 Q74.1 67.3 72.2 68.0 Q70.4 68.7 67.7 70.0 Q65.1 71.3 61.9 73.2 Q58.8 75.1 58.0 75.2 Q57.1 75.3 56.6 74.9 Q56.1 74.5 56.0 73.6 Q56.0 72.7 56.5 71.7 Q57.0 70.6 59.0 68.6 Q61.0 66.6 63.0 65.2 Q65.0 63.7 66.5 63.0 Q67.9 62.3 69.4 61.9 Q71.0 61.6 72.7 61.7 Q74.5 61.8 75.4 62.5 Q76.2 63.1 76.3 63.5Z"
        />
        <path
          fill="#6D28D9"
          d="M24.6 62.4 Q25.4 61.8 27.2 61.7 Q29.0 61.6 30.7 62.0 Q32.3 62.4 33.6 63.1 Q34.9 63.7 36.8 65.1 Q38.8 66.5 40.6 68.3 Q42.5 70.1 43.2 71.4 Q43.9 72.6 44.0 73.2 Q44.0 73.8 43.9 74.2 Q43.7 74.7 43.3 75.0 Q42.9 75.3 42.0 75.2 Q41.1 75.1 37.3 72.8 Q33.5 70.6 29.4 68.9 Q25.4 67.1 24.5 66.2 Q23.7 65.2 23.5 64.5 Q23.4 63.8 23.6 63.4 Q23.8 63.0 24.6 62.4Z"
        />
        <path
          fill="#6D28D9"
          d="M83.1 22.8 Q83.6 23.4 83.8 24.5 Q84.1 25.5 84.0 28.2 Q84.0 30.9 83.2 34.0 Q82.4 37.1 81.6 39.1 Q80.7 41.0 80.4 41.2 Q80.1 41.3 78.6 39.1 Q77.0 36.9 77.6 35.5 Q78.1 34.1 78.0 33.5 Q78.0 32.9 77.6 32.6 Q77.2 32.3 74.2 32.4 Q71.3 32.4 71.1 32.3 Q71.0 32.1 72.2 30.3 Q73.5 28.6 75.5 26.6 Q77.4 24.7 79.3 23.5 Q81.1 22.4 81.9 22.3 Q82.6 22.2 83.1 22.8Z"
        />
        <path
          fill="#6D28D9"
          d="M18.5 22.5 Q19.6 22.7 21.0 23.7 Q22.4 24.6 24.0 26.2 Q25.6 27.8 27.3 29.9 Q28.9 32.1 28.7 32.3 Q28.6 32.4 25.6 32.4 Q22.7 32.3 22.3 32.6 Q21.9 32.9 21.8 33.4 Q21.8 34.0 22.3 35.5 Q22.8 37.0 21.3 39.2 Q19.8 41.3 19.4 40.9 Q19.0 40.5 18.2 38.8 Q17.4 37.0 16.7 33.8 Q15.9 30.7 15.9 28.2 Q15.8 25.8 15.9 25.0 Q16.0 24.2 16.3 23.5 Q16.6 22.8 17.0 22.5 Q17.4 22.2 18.5 22.5Z"
        />
      </svg>
    );
  }

  const combinedClass = `lucide-icon doks-svg-icon ${cls} ${className}`.trim();

  const renderPath = () => {
    switch (name) {
      // Tools
      case 'select':
        return (
          <>
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            <path d="M13 13l6 6" />
          </>
        );
      case 'hand':
        return (
          <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8a7 7 0 0 0 7 7h2a7 7 0 0 0 7-7v-3a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2" />
        );
      case 'sticky':
      case 'sticky-note':
        return (
          <>
            <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z" />
            <path d="M15 3v6h6" />
            <path d="M7 13h10" />
            <path d="M7 17h6" />
          </>
        );
      case 'text':
      case 'type':
        return (
          <>
            <polyline points="4 7 4 4 20 4 20 7" />
            <line x1="9" y1="20" x2="15" y2="20" />
            <line x1="12" y1="4" x2="12" y2="20" />
          </>
        );
      case 'frame':
        return (
          <>
            <line x1="22" y1="6" x2="2" y2="6" />
            <line x1="22" y1="18" x2="2" y2="18" />
            <line x1="6" y1="2" x2="6" y2="22" />
            <line x1="18" y1="2" x2="18" y2="22" />
          </>
        );
      case 'shape':
      case 'square':
        return <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />;
      case 'circle':
        return <circle cx="12" cy="12" r="10" />;
      case 'diamond':
        return <polygon points="12 2 22 12 12 22 2 12" />;
      case 'triangle':
        return <polygon points="12 3 22 21 2 21" />;
      case 'parallelogram':
        return <polygon points="6 4 21 4 18 20 3 20" />;
      case 'cylinder':
        return (
          <>
            <path d="M4 6a8 3 0 0 1 16 0v12a8 3 0 0 1-16 0z" fill="none" />
            <path d="M4 6a8 3 0 0 0 16 0" fill="none" />
          </>
        );
      case 'hexagon':
        return <polygon points="12 2 21 7 21 17 12 22 3 17 3 7" />;
      case 'arrow':
      case 'arrow-right':
        return (
          <>
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </>
        );
      case 'arrow-down':
        return (
          <>
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </>
        );
      case 'arrow-up':
        return (
          <>
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </>
        );
      case 'note-card':
        return (
          <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="7" y1="8" x2="17" y2="8" />
            <line x1="7" y1="12" x2="13" y2="12" />
            <circle cx="16" cy="14" r="2" />
            <path d="M16 12v-1" />
          </>
        );
      case 'attachment':
      case 'paperclip':
        return (
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        );

      // Scopes & Network
      case 'lock':
      case 'lock-node':
        return (
          <>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </>
        );
      case 'unlock-node':
        return (
          <>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 9.9-1" />
          </>
        );
      case 'network':
      case 'globe-mesh':
        return (
          <>
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </>
        );
      case 'wifi':
        return (
          <>
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </>
        );
      case 'wifi-off':
        return (
          <>
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </>
        );
      case 'key':
        return (
          <>
            <path d="M21 2l-2 2m-1.5 1.5L14 9l-1.5-1.5M10 13l-4 4-2-2-2 2 4 4 4-4" />
            <circle cx="7.5" cy="16.5" r="5.5" />
          </>
        );
      case 'users':
        return (
          <>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </>
        );
      case 'promote':
        return (
          <>
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </>
        );
      case 'fork':
        return (
          <>
            <circle cx="6" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="9" r="3" />
            <path d="M6 9v6" />
            <path d="M18 9c0 4.5-5 6-12 6" />
          </>
        );

      // Workspace & Views
      case 'layout-canvas':
      case 'layout':
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </>
        );
      case 'layout-split':
      case 'columns':
      case 'split':
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="12" y1="3" x2="12" y2="21" />
          </>
        );
      case 'layout-doc':
        return (
          <>
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <line x1="8" y1="6" x2="16" y2="6" />
            <line x1="8" y1="10" x2="16" y2="10" />
            <line x1="8" y1="14" x2="12" y2="14" />
          </>
        );
      case 'sidebar-left':
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </>
        );
      case 'minimap':
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <rect x="13" y="13" width="6" height="6" rx="1" />
          </>
        );
      case 'grid':
        return (
          <>
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </>
        );
      case 'grip-vertical':
        return (
          <>
            <circle cx="9" cy="6" r="1.5" fill="currentColor" />
            <circle cx="15" cy="6" r="1.5" fill="currentColor" />
            <circle cx="9" cy="12" r="1.5" fill="currentColor" />
            <circle cx="15" cy="12" r="1.5" fill="currentColor" />
            <circle cx="9" cy="18" r="1.5" fill="currentColor" />
            <circle cx="15" cy="18" r="1.5" fill="currentColor" />
          </>
        );
      case 'zoom-in':
        return (
          <>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </>
        );
      case 'zoom-out':
        return (
          <>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </>
        );
      case 'maximize':
        return (
          <>
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </>
        );
      case 'minimize':
        return (
          <>
            <path d="M4 14h6m0 0v6m0-6l-7 7m17-11h-6m0 0V4m0 6l7-7" />
          </>
        );

      // Actions & Files
      case 'plus':
        return (
          <>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </>
        );
      case 'minus':
        return <line x1="5" y1="12" x2="19" y2="12" />;
      case 'folder':
        return (
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        );
      case 'folder-open':
        return (
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v2M2 10h20l-2 9H4z" />
        );
      case 'folder-plus':
        return (
          <>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </>
        );
      case 'file':
        return (
          <>
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
          </>
        );
      case 'file-text':
        return (
          <>
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <line x1="10" y1="9" x2="8" y2="9" />
          </>
        );
      case 'file-code':
        return (
          <>
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <polyline points="10 13 8 15 10 17" />
            <polyline points="14 13 16 15 14 17" />
          </>
        );
      case 'image':
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </>
        );
      case 'film':
        return (
          <>
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
            <line x1="7" y1="2" x2="7" y2="22" />
            <line x1="17" y1="2" x2="17" y2="22" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <line x1="2" y1="7" x2="7" y2="7" />
            <line x1="2" y1="17" x2="7" y2="17" />
            <line x1="17" y1="17" x2="22" y2="17" />
            <line x1="17" y1="7" x2="22" y2="7" />
          </>
        );
      case 'music':
        return (
          <>
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </>
        );
      case 'archive':
        return (
          <>
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </>
        );
      case 'search':
        return (
          <>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </>
        );
      case 'command':
        return (
          <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
        );
      case 'trash':
        return (
          <>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </>
        );
      case 'restore':
        return (
          <>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </>
        );
      case 'history':
        return (
          <>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </>
        );
      case 'download':
        return (
          <>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </>
        );
      case 'upload':
        return (
          <>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </>
        );
      case 'cpu':
        return (
          <>
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" />
            <line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" />
            <line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" />
            <line x1="20" y1="15" x2="23" y2="15" />
            <line x1="1" y1="9" x2="4" y2="9" />
            <line x1="1" y1="15" x2="4" y2="15" />
          </>
        );
      case 'check':
        return <polyline points="20 6 9 17 4 12" />;
      case 'check-square':
        return (
          <>
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </>
        );
      case 'x':
        return (
          <>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </>
        );
      case 'more-horizontal':
        return (
          <>
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </>
        );
      case 'more-vertical':
        return (
          <>
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
          </>
        );
      case 'chevron-right':
        return <polyline points="9 18 15 12 9 6" />;
      case 'chevron-down':
        return <polyline points="6 9 12 15 18 9" />;
      case 'copy':
        return (
          <>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </>
        );
      case 'edit':
        return (
          <>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </>
        );
      case 'layers':
        return (
          <>
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </>
        );
      case 'alert-triangle':
        return (
          <>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </>
        );
      case 'info':
        return (
          <>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </>
        );
      case 'sparkles':
        return (
          <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
        );
      case 'pin':
        return (
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        );
      case 'link':
        return (
          <>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </>
        );
      case 'eye':
        return (
          <>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </>
        );
      case 'sun':
        return (
          <>
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </>
        );
      case 'moon':
        return <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;
      case 'move':
        return (
          <>
            <polyline points="5 9 2 12 5 15" />
            <polyline points="9 5 12 2 15 5" />
            <polyline points="15 19 12 22 9 19" />
            <polyline points="19 9 22 12 19 15" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <line x1="12" y1="2" x2="12" y2="22" />
          </>
        );
      case 'share':
        return (
          <>
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </>
        );
      case 'settings':
        return (
          <>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </>
        );
      case 'menu':
        return (
          <>
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </>
        );
      case 'undo':
      case 'rotate-ccw':
        return (
          <>
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </>
        );
      case 'redo':
      case 'refresh':
      case 'rotate-cw':
        return (
          <>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </>
        );
      case 'pen':
      case 'brush':
        return (
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        );
      case 'eraser':
        return (
          <>
            <path d="M20 20H7L3 16C2 15 2 13 3 12L13 2C14 1 16 1 17 2L21 6C22 7 22 9 21 10L14 17" />
            <line x1="17" y1="17" x2="11" y2="11" />
          </>
        );
      case 'thumbs-up':
        return (
          <path d="M7 10v12m0-12H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3m0-12 5-7a2.5 2.5 0 0 1 3.5 1.5 2 2 0 0 1 .5 1.5v3h5a2 2 0 0 1 2 2v2a2 2 0 0 1-.5 1.5l-3 7A2 2 0 0 1 18 22H7" />
        );
      case 'table':
        return (
          <>
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </>
        );
      case 'kanban':
        return (
          <>
            <rect width="5" height="14" x="3" y="5" rx="1" />
            <rect width="5" height="10" x="10" y="5" rx="1" />
            <rect width="5" height="15" x="17" y="5" rx="1" />
          </>
        );
      case 'code':
        return (
          <>
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </>
        );
      case 'checklist':
        return (
          <>
            <path d="M11 6h9M11 12h9M11 18h9" />
            <polyline points="4 6 5 7 8 4" />
            <polyline points="4 12 5 13 8 10" />
            <polyline points="4 18 5 19 8 16" />
          </>
        );
      case 'chart':
      case 'bar-chart':
        return (
          <>
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </>
        );
      case 'pie-chart':
        return (
          <>
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
            <path d="M22 12A10 10 0 0 0 12 2v10z" />
          </>
        );
      case 'smartphone':
        return (
          <>
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </>
        );
      case 'monitor':
        return (
          <>
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </>
        );
      default:
        return <circle cx="12" cy="12" r="9" />;
    }
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      class={combinedClass}
      style={style}
      aria-hidden="true"
    >
      {renderPath()}
    </svg>
  );
}

export default Icon;
