import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { searchQuery, openTab, searchIndex } from '../../state/app-state.js';
import type { SearchResult } from '../../search/indexer.js';
import { Icon } from '../../ui/icons.js';

export function SearchScreen() {
  const [query, setQuery] = useState(searchQuery.value);
  const [results, setResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim()) {
      setResults(searchIndex.search(query));
    } else {
      setResults([]);
    }
  }, [query]);

  const handleOpenResult = (item: SearchResult) => {
    openTab(item.type, item.id, item.title);
  };

  return (
    <div class="search-screen-container">
      <div class="search-screen-header">
        <div class="search-input-wrapper">
          <Icon name="search" size={20} class="search-input-icon" />
          <input
            ref={inputRef}
            type="text"
            class="search-main-input"
            placeholder="Поиск по заметкам, доскам и стикерам (Ctrl+Shift+F)..."
            value={query}
            onInput={(e) => {
              const val = (e.target as HTMLInputElement).value;
              setQuery(val);
              searchQuery.value = val;
            }}
          />
          {query && (
            <button
              class="search-clear-btn"
              onClick={() => {
                setQuery('');
                searchQuery.value = '';
              }}
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      </div>

      <div class="search-screen-body">
        {query.trim() === '' ? (
          <div class="search-empty-state">
            <Icon name="search" size={40} class="empty-icon" />
            <h3>Поиск по всему хранилищу</h3>
            <p>
              Введите запрос для поиска по названиям, содержимому заметок, стикерам досок и тегам.
            </p>
            <div class="search-tips">
              <span>Поддерживается русская нормализация (ё = е), префиксный и нечёткий поиск.</span>
            </div>
          </div>
        ) : results.length === 0 ? (
          <div class="search-empty-state">
            <Icon name="file" size={40} class="empty-icon" />
            <h3>Ничего не найдено</h3>
            <p>По запросу «{query}» совпадений нет.</p>
          </div>
        ) : (
          <div class="search-results-list">
            <div class="search-results-count">
              Найдено результатов: {results.length}
            </div>

            {results.map((res) => (
              <div
                key={res.id}
                class="search-result-card"
                onClick={() => handleOpenResult(res)}
              >
                <div class="search-result-top">
                  <div class="search-result-title-group">
                    <Icon name={res.type === 'board' ? 'layout' : 'file-text'} size={16} />
                    <span class="search-result-title">{res.title}</span>
                  </div>
                  <span class="search-result-badge">{res.type === 'board' ? 'Доска' : 'Заметка'}</span>
                </div>

                {res.snippet && (
                  <div class="search-result-snippet">
                    {res.snippet}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
