import { h } from 'preact';
import { connectionState, agentStatus } from '../../state/yjs-client.js';
import { currentView, isCommandPaletteOpen } from '../../state/app-state.js';
import { Icon } from '../../ui/icons.js';

export function StatusBar() {
  const status = agentStatus.value;
  const conn = connectionState.value;

  const connectedCount = status?.connectedCount ?? 0;
  const radminFound = status?.radminFound ?? false;
  const effectiveIp = status?.effectiveIp ?? '127.0.0.1';
  const memberName = status?.memberName || 'Пользователь';
  const memberColor = status?.memberColor || '#7c8cff';

  return (
    <footer class="app-status-bar">
      <div class="status-left">
        <div class="status-indicator">
          {conn === 'connected' ? (
            <span class="status-badge success" title="Подключено к локальному агенту">
              <span class="status-dot green"></span>
              <span class="status-label">Синхронизировано</span>
            </span>
          ) : conn === 'connecting' ? (
            <span class="status-badge warning" title="Подключение к агенту...">
              <span class="status-dot amber"></span>
              <span class="status-label">Подключение...</span>
            </span>
          ) : (
            <span class="status-badge danger" title="Агент недоступен, работаем автономно">
              <span class="status-dot red"></span>
              <span class="status-label">Офлайн</span>
            </span>
          )}
        </div>

        <div
          class={`radmin-badge ${radminFound ? 'found' : 'missing'}`}
          onClick={() => (currentView.value = 'network')}
          title={radminFound ? `Слушаем интерфейс Radmin VPN (${effectiveIp})` : 'Radmin VPN не обнаружен. Проверьте подключение Radmin.'}
        >
          <Icon name={radminFound ? 'wifi' : 'wifi-off'} size={13} />
          <span>{radminFound ? `Radmin: ${effectiveIp}` : 'Radmin не найден'}</span>
        </div>
      </div>

      <div class="status-right">
        <button
          class="status-command-btn"
          onClick={() => (isCommandPaletteOpen.value = true)}
          title="Открыть командную палитру (Ctrl+P)"
        >
          <Icon name="sparkles" size={13} />
          <span>Команды (Ctrl+P)</span>
        </button>

        <div
          class="peers-count-badge"
          onClick={() => (currentView.value = 'network')}
          title="Открыть участников и сеть"
        >
          <span class={`peers-dot ${connectedCount > 0 ? 'online' : 'solo'}`}></span>
          <span>{connectedCount + 1} в сети</span>
        </div>

        <div
          class="user-profile-badge"
          onClick={() => (currentView.value = 'network')}
          title="Ваш профиль соавтора"
        >
          <span class="user-color-dot" style={{ backgroundColor: memberColor }}></span>
          <span class="user-name">{memberName}</span>
        </div>
      </div>
    </footer>
  );
}
