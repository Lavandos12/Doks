import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { connectionState, agentStatus } from '../../state/yjs-client.js';
import { currentView, isCommandPaletteOpen, currentScope } from '../../state/app-state.js';
import { currentLanguage, setLanguage, t } from '../../i18n/index.js';
import { Icon } from '../../ui/icons.js';
import { NetworkPopover } from './network-popover.js';

export function StatusBar() {
  const [isNetworkPopoverOpen, setIsNetworkPopoverOpen] = useState(false);
  const status = agentStatus.value;
  const conn = connectionState.value;

  const connectedCount = status?.connectedCount ?? 0;
  const radminFound = status?.radminFound ?? false;
  const effectiveIp = status?.effectiveIp ?? '127.0.0.1';
  const displayName = (!status?.memberName || status.memberName === 'Tester') ? 'Вы' : status.memberName;
  const memberColor = status?.memberColor || '#7c8cff';

  return (
    <Fragment>
      <footer class="app-status-bar">
        <div class="status-left">
          <div class="status-indicator">
            {currentScope.value === 'solo' ? (
              <span class="status-badge success" title="Личное пространство активно и сохраняется локально">
                <span class="status-dot green"></span>
                <span class="status-label">Локально • Соло</span>
              </span>
            ) : conn === 'connected' ? (
              <span class="status-badge success" title="Подключено к локальному агенту и синхронизировано">
                <span class="status-dot green"></span>
                <span class="status-label">Синхронизировано • Команда</span>
              </span>
            ) : conn === 'connecting' ? (
              <span class="status-badge warning" title="Подключение к агенту...">
                <span class="status-dot amber"></span>
                <span class="status-label">{t('status.connecting')}</span>
              </span>
            ) : (
              <span class="status-badge danger" title="Агент недоступен, работаем автономно">
                <span class="status-dot red"></span>
                <span class="status-label">{t('status.offline')}</span>
              </span>
            )}
          </div>

          {currentScope.value === 'solo' ? (
            <div
              class="radmin-badge solo-mode"
              title="Личное пространство активно (без синхронизации по сети)"
            >
              <Icon name="lock" size={13} />
              <span>Локальное хранилище</span>
            </div>
          ) : (
            <div
              class={`radmin-badge ${radminFound ? 'found' : 'missing'}`}
              onClick={() => setIsNetworkPopoverOpen(true)}
              style={{ cursor: 'pointer' }}
              title={
                radminFound
                  ? `Слушаем интерфейс Radmin VPN (${effectiveIp}). Нажмите для настроек сети.`
                  : status?.preferredMeshIp && status.preferredMeshIp !== '127.0.0.1'
                    ? `Слушаем локальный интерфейс (${effectiveIp}). Нажмите для настроек сети.`
                    : 'P2P сеть: Локальная команда. Нажмите для настроек сети.'
              }
            >
              <Icon name={radminFound ? 'wifi' : 'wifi-off'} size={13} />
              <span>
                {radminFound
                  ? t('status.radmin_found', { ip: effectiveIp })
                  : status?.preferredMeshIp && status.preferredMeshIp !== '127.0.0.1'
                    ? `LAN: ${effectiveIp}`
                    : 'Локальная команда'}
              </span>
            </div>
          )}
        </div>

        <div class="status-right">
          <button
            class="status-command-btn"
            onClick={() => (isCommandPaletteOpen.value = true)}
            title="Открыть командную палитру (Ctrl+P)"
          >
            <Icon name="sparkles" size={13} />
            <span>{t('status.commands')}</span>
          </button>

          <button
            class="status-lang-btn"
            onClick={() => setLanguage(currentLanguage.value === 'ru' ? 'en' : 'ru')}
            title={currentLanguage.value === 'ru' ? 'Switch to English' : 'Переключить на русский'}
          >
            <span>{currentLanguage.value === 'ru' ? 'RU' : 'EN'}</span>
          </button>

          <div
            class="peers-count-badge"
            onClick={() => setIsNetworkPopoverOpen(true)}
            style={{ cursor: 'pointer' }}
            title="Открыть участников и сеть"
          >
            <span class={`peers-dot ${currentScope.value === 'solo' ? 'solo' : connectedCount > 0 ? 'online' : 'solo'}`}></span>
            <span>{currentScope.value === 'solo' ? 'Соло (Вы)' : t('status.online_count', { count: connectedCount + 1 })}</span>
          </div>

          <div
            class="user-profile-badge"
            onClick={() => (currentView.value = 'network')}
            title={t('status.user_profile')}
          >
            <span class="user-color-dot" style={{ backgroundColor: memberColor }}></span>
            <span class="user-name">{displayName}</span>
          </div>
        </div>
      </footer>

      <NetworkPopover
        isOpen={isNetworkPopoverOpen}
        onClose={() => setIsNetworkPopoverOpen(false)}
      />
    </Fragment>
  );
}
