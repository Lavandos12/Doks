import { h } from 'preact';
import {
  currentView,
  selectedNoteId,
  selectedBoardId,
  createNote,
  createBoard,
  theme
} from './state/app-state.js';
import { Sidebar } from './components/layout/sidebar.js';
import { NoteEditor } from './components/notes/editor.js';
import { BoardCanvas } from './components/board/board-canvas.js';
import { NetworkScreen } from './components/network/network-screen.js';
import { HistoryScreen } from './components/history/history-screen.js';

export function App() {
  return (
    <div class={`app-layout theme-${theme.value}`}>
      <Sidebar />

      <main class="main-viewport">
        {currentView.value === 'notes' && (
          selectedNoteId.value ? (
            <NoteEditor noteId={selectedNoteId.value} />
          ) : (
            <div class="empty-view-placeholder">
              <span class="placeholder-icon">📝</span>
              <h2>Выберите или создайте заметку</h2>
              <p>Markdown-заметки с поддержкой связей [[название]] и локальным поиском.</p>
              <button class="btn-primary" onClick={() => createNote()}>
                Создать заметку
              </button>
            </div>
          )
        )}

        {currentView.value === 'board' && (
          selectedBoardId.value ? (
            <BoardCanvas boardId={selectedBoardId.value} />
          ) : (
            <div class="empty-view-placeholder">
              <span class="placeholder-icon">📋</span>
              <h2>Выберите или создайте доску</h2>
              <p>Бесконечный холст со стикерами, текстом, рамками и соединительными стрелками.</p>
              <button class="btn-primary" onClick={() => createBoard()}>
                Создать доску
              </button>
            </div>
          )
        )}

        {currentView.value === 'network' && <NetworkScreen />}
        {currentView.value === 'history' && <HistoryScreen />}
      </main>
    </div>
  );
}
