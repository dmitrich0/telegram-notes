(() => {
  'use strict';

  const INDEX_KEY = 'notes_index';
  const NOTE_PREFIX = 'note_';
  const MAX_TITLE_LENGTH = 160;
  // CloudStorage values are capped at 4096 characters; leave room for JSON metadata.
  const MAX_BODY_LENGTH = 3500;
  const AUTOSAVE_DELAY = 650;
  const SAVE_TIMEOUT = 8000;
  const tg = window.Telegram?.WebApp;
  const cloudStorage = tg?.CloudStorage;

  const el = (id) => document.getElementById(id);
  const listScreen = el('list-screen');
  const editorScreen = el('editor-screen');
  const notesList = el('notes-list');
  const emptyState = el('empty-state');
  const notice = el('list-notice');
  const titleInput = el('note-title');
  const bodyInput = el('note-body');
  const saveStatus = el('save-status');
  const retrySave = el('retry-save');
  const limitStatus = el('limit-status');

  let index = [];
  let currentNote = null;
  let saveTimer = null;
  let saving = false;
  let hasUnsavedChanges = false;
  let saveOperationId = 0;
  let swipeState = null;
  let suppressOpenUntil = 0;

  function applyTelegramTheme() {
    if (!tg) return;
    tg.ready();
    tg.expand();
    const theme = tg.themeParams || {};
    document.documentElement.style.setProperty('--bg', theme.bg_color || '#f6f6f6');
    document.documentElement.style.setProperty('--secondary-bg', theme.secondary_bg_color || theme.bg_color || '#ffffff');
    document.documentElement.style.setProperty('--text', theme.text_color || '#161616');
    document.documentElement.style.setProperty('--hint', theme.hint_color || '#8b8b91');
    document.documentElement.style.setProperty('--button', theme.button_color || '#2678d9');
    document.documentElement.style.setProperty('--button-text', theme.button_text_color || '#ffffff');
  }

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      cloudStorage.getItem(key, (error, value) => error ? reject(new Error(error)) : resolve(value));
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve, reject) => {
      cloudStorage.setItem(key, value, (error) => error ? reject(new Error(error)) : resolve());
    });
  }

  function storageRemove(key) {
    return new Promise((resolve, reject) => {
      cloudStorage.removeItem(key, (error) => error ? reject(new Error(error)) : resolve());
    });
  }

  function renderTelegramOnlyMessage() {
    document.title = 'Откройте в Telegram';
    el('app').replaceChildren(Object.assign(document.createElement('section'), {
      className: 'telegram-only-message',
      innerHTML: '<div class="empty-icon" aria-hidden="true">✈</div><h1>Откройте приложение в Telegram</h1><p>Заметки хранятся в Telegram CloudStorage и доступны только внутри Mini App.</p>'
    }));
  }

  function safeParse(value, fallback) {
    if (!value) return fallback;
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function displayTitle(note) {
    const title = (note.title || '').trim();
    if (title) return title;
    const fromBody = (note.body || '').trim().replace(/\s+/g, ' ');
    return fromBody.slice(0, 60) || 'Новая заметка';
  }

  function formatDate(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Недавно';
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
    if (sameDay) return `Сегодня, ${time}`;
    const sameYear = date.getFullYear() === now.getFullYear();
    return new Intl.DateTimeFormat('ru-RU', sameYear
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.hidden = !message;
    notice.classList.toggle('error', isError);
  }

  function formatSavedAt(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Сохранено';
    const now = new Date();
    const time = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(date);
    if (date.toDateString() === now.toDateString()) return `Сохранено сегодня в ${time}`;
    const day = new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(date);
    return `Сохранено ${day} в ${time}`;
  }

  function setSaveStatus(message, canRetry = false) {
    saveStatus.textContent = message;
    retrySave.hidden = !canRetry;
  }

  async function loadIndex() {
    const raw = await storageGet(INDEX_KEY);
    const parsed = safeParse(raw, null);
    if (!Array.isArray(parsed)) {
      if (raw) showNotice('Не удалось прочитать список заметок. Он будет восстановлен при следующем сохранении.', true);
      return [];
    }
    return parsed.filter((item) => item && typeof item.id === 'string' && typeof item.updatedAt === 'string');
  }

  function sortedIndex() {
    return [...index].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function renderList() {
    const notes = sortedIndex();
    notesList.replaceChildren();
    emptyState.hidden = notes.length !== 0;
    for (const note of notes) {
      const item = document.createElement('div');
      item.className = 'swipe-note';
      item.dataset.id = note.id;
      const indicator = document.createElement('div');
      indicator.className = 'swipe-delete-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.innerHTML = '<span class="swipe-delete-icon"><svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 12H8L7 9Zm3 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z"/></svg></span>';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-row';
      button.dataset.id = note.id;
      const title = document.createElement('span');
      title.className = 'note-title';
      title.textContent = note.title || 'Новая заметка';
      const time = document.createElement('span');
      time.className = 'note-time';
      time.textContent = formatDate(note.updatedAt);
      button.append(title, time);
      item.append(indicator, button);
      notesList.append(item);
    }
  }

  function updateLimitStatus() {
    const length = bodyInput.value.length;
    const remaining = MAX_BODY_LENGTH - length;
    limitStatus.className = 'limit-status';
    if (remaining <= 0) {
      limitStatus.textContent = `Достигнут лимит: ${MAX_BODY_LENGTH} символов`;
      limitStatus.classList.add('error');
    } else if (remaining < 300) {
      limitStatus.textContent = `Осталось символов: ${remaining}`;
      limitStatus.classList.add('warning');
    } else {
      limitStatus.textContent = '';
    }
  }

  function openEditor(note, isNew = false) {
    currentNote = note;
    hasUnsavedChanges = isNew;
    titleInput.value = note.title || '';
    bodyInput.value = note.body || '';
    updateLimitStatus();
    setSaveStatus(isNew ? '' : formatSavedAt(note.updatedAt));
    listScreen.hidden = true;
    editorScreen.hidden = false;
    tg?.BackButton?.show();
    setTimeout(() => titleInput.focus(), 0);
  }

  function newNote() {
    openEditor({ id: makeId(), title: '', body: '', updatedAt: new Date().toISOString() }, true);
  }

  async function openNote(id) {
    showNotice('Загружаем…');
    try {
      const raw = await storageGet(NOTE_PREFIX + id);
      const note = safeParse(raw, null);
      if (!note || note.id !== id) throw new Error('Заметка не найдена или повреждена');
      showNotice('');
      openEditor(note);
    } catch (error) {
      showNotice(`Не удалось открыть заметку: ${error.message}`, true);
    }
  }

  function currentValues() {
    return {
      ...currentNote,
      title: titleInput.value.slice(0, MAX_TITLE_LENGTH),
      body: bodyInput.value.slice(0, MAX_BODY_LENGTH),
    };
  }

  function createSaveTimeout(operationId) {
    let timer;
    const promise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (saveOperationId === operationId) saveOperationId += 1;
        reject(new Error('Время ожидания сохранения истекло. Проверьте соединение и повторите попытку'));
      }, SAVE_TIMEOUT);
    });
    return { promise, cancel: () => clearTimeout(timer) };
  }

  async function saveCurrentNote() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!currentNote || saving || !hasUnsavedChanges) return true;
    saving = true;
    setSaveStatus('Сохраняем…');
    const note = currentValues();
    note.updatedAt = new Date().toISOString();
    const operationId = ++saveOperationId;
    const timeout = createSaveTimeout(operationId);
    try {
      const serialized = JSON.stringify(note);
      if (serialized.length > 4096) throw new Error('Текст заметки слишком длинный для CloudStorage');
      const meta = { id: note.id, title: displayTitle(note), updatedAt: note.updatedAt };
      const nextIndex = [...index.filter((item) => item.id !== note.id), meta];
      const write = (async () => {
        // Save body first: a failed write never points the index to non-existent data.
        await storageSet(NOTE_PREFIX + note.id, serialized);
        // CloudStorage has no abort API. Do not continue a request that timed out.
        if (operationId !== saveOperationId) return;
        await storageSet(INDEX_KEY, JSON.stringify(nextIndex));
        if (operationId !== saveOperationId) return;
        index = nextIndex;
        if (currentNote?.id === note.id) {
          currentNote = note;
          hasUnsavedChanges = false;
        }
        if (!listScreen.hidden) renderList();
      })();
      await Promise.race([write, timeout.promise]);
      if (operationId !== saveOperationId) throw new Error('Сохранение отменено по тайм-ауту');
      if (currentNote?.id === note.id) setSaveStatus(formatSavedAt(note.updatedAt));
      return true;
    } catch (error) {
      if (currentNote?.id === note.id) setSaveStatus('Не сохранено', true);
      showNotice(`Не удалось сохранить: ${error.message}. Текст остаётся в редакторе.`, true);
      return false;
    } finally {
      timeout.cancel();
      saving = false;
    }
  }

  function scheduleSave() {
    hasUnsavedChanges = true;
    setSaveStatus('Изменено');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCurrentNote, AUTOSAVE_DELAY);
  }

  function returnToList() {
    clearTimeout(saveTimer);
    // The list must open immediately. The request continues in the background.
    if (hasUnsavedChanges && !saving) saveCurrentNote();
    editorScreen.hidden = true;
    listScreen.hidden = false;
    tg?.BackButton?.hide();
    renderList();
  }

  async function deleteNoteBySwipe(id) {
    const previousIndex = index;
    const nextIndex = index.filter((item) => item.id !== id);
    index = nextIndex;
    renderList();
    try {
      await storageSet(INDEX_KEY, JSON.stringify(nextIndex));
      await storageRemove(NOTE_PREFIX + id);
    } catch (error) {
      index = previousIndex;
      renderList();
      showNotice(`Не удалось удалить заметку: ${error.message}`, true);
    }
  }

  async function deleteCurrentNote() {
    if (!currentNote) return;
    const confirmed = await new Promise((resolve) => {
      if (tg?.showConfirm) tg.showConfirm('Удалить заметку без возможности восстановления?', resolve);
      else resolve(window.confirm('Удалить заметку без возможности восстановления?'));
    });
    if (!confirmed) return;
    clearTimeout(saveTimer);
    try {
      setSaveStatus('Удаляем…');
      const nextIndex = index.filter((item) => item.id !== currentNote.id);
      await storageRemove(NOTE_PREFIX + currentNote.id);
      await storageSet(INDEX_KEY, JSON.stringify(nextIndex));
      index = nextIndex;
      hasUnsavedChanges = false;
      returnToList();
    } catch (error) {
      setSaveStatus('Не удалено');
      showNotice(`Не удалось удалить заметку: ${error.message}`, true);
    }
  }

  el('create-note').addEventListener('click', newNote);
  el('create-first-note').addEventListener('click', newNote);
  el('back-to-list').addEventListener('click', returnToList);
  el('delete-note').addEventListener('click', deleteCurrentNote);
  retrySave.addEventListener('click', () => {
    if (!saving && hasUnsavedChanges) saveCurrentNote();
  });
  notesList.addEventListener('click', (event) => {
    if (Date.now() < suppressOpenUntil) return;
    const row = event.target.closest('.note-row');
    if (row) openNote(row.dataset.id);
  });
  titleInput.addEventListener('input', scheduleSave);
  bodyInput.addEventListener('input', () => {
    if (bodyInput.value.length > MAX_BODY_LENGTH) bodyInput.value = bodyInput.value.slice(0, MAX_BODY_LENGTH);
    updateLimitStatus();
    scheduleSave();
  });

  // A left swipe must finish beyond this distance. Moving the finger back cancels deletion.
  const DELETE_SWIPE_DISTANCE = 96;
  function startDeleteSwipe(row, key, startX, startY) {
    swipeState = {
      id: row.dataset.id,
      item: row.closest('.swipe-note'),
      row,
      indicator: row.closest('.swipe-note').querySelector('.swipe-delete-indicator'),
      key,
      startX,
      startY,
      isHorizontal: false
    };
  }
  function moveDeleteSwipe(key, clientX, clientY) {
    if (!swipeState || key !== swipeState.key) return false;
    const deltaX = clientX - swipeState.startX;
    const deltaY = clientY - swipeState.startY;
    if (!swipeState.isHorizontal) {
      if (Math.abs(deltaX) < 12) return;
      if (Math.abs(deltaX) <= Math.abs(deltaY)) {
        swipeState = null;
        return false;
      }
      swipeState.isHorizontal = true;
    }
    const offset = Math.max(-DELETE_SWIPE_DISTANCE, Math.min(0, deltaX));
    swipeState.item.classList.add('dragging');
    swipeState.item.classList.toggle('armed', offset <= -DELETE_SWIPE_DISTANCE);
    swipeState.row.style.transform = `translateX(${offset}px)`;
    swipeState.indicator.style.opacity = String(Math.min(1, Math.abs(offset) / 72));
    return true;
  }
  function finishDeleteSwipe(key, clientX) {
    if (!swipeState || key !== swipeState.key) return;
    const state = swipeState;
    swipeState = null;
    const finalDistance = clientX - state.startX;
    // Use the final position, not the furthest point: returning the finger cancels the swipe.
    if (state.isHorizontal && finalDistance <= -DELETE_SWIPE_DISTANCE) {
      suppressOpenUntil = Date.now() + 350;
      state.item.classList.remove('dragging');
      state.item.classList.add('deleting');
      state.row.style.transform = `translateX(-${DELETE_SWIPE_DISTANCE}px)`;
      state.indicator.style.opacity = '1';
      tg?.HapticFeedback?.impactOccurred('medium');
      navigator.vibrate?.(18);
      setTimeout(() => deleteNoteBySwipe(state.id), 130);
      return;
    }
    state.item.classList.remove('dragging', 'armed');
    state.row.style.transform = '';
    state.indicator.style.opacity = '';
  }
  function cancelDeleteSwipe(key) {
    if (!swipeState || key !== swipeState.key) return;
    const state = swipeState;
    swipeState = null;
    state.item.classList.remove('dragging', 'armed');
    state.row.style.transform = '';
    state.indicator.style.opacity = '';
  }

  // Telegram mobile clients reliably send Touch Events. Pointer Events cover desktop and a mouse.
  notesList.addEventListener('touchstart', (event) => {
    const row = event.target.closest('.note-row');
    const touch = event.changedTouches[0];
    if (row && touch) startDeleteSwipe(row, `touch-${touch.identifier}`, touch.clientX, touch.clientY);
  }, { passive: true });
  notesList.addEventListener('touchmove', (event) => {
    if (!swipeState || !String(swipeState.key).startsWith('touch-')) return;
    const touchId = Number(String(swipeState.key).slice(6));
    const touch = Array.from(event.changedTouches).find((item) => item.identifier === touchId);
    if (touch && moveDeleteSwipe(swipeState.key, touch.clientX, touch.clientY)) event.preventDefault();
  }, { passive: false });
  notesList.addEventListener('touchend', (event) => {
    if (!swipeState || !String(swipeState.key).startsWith('touch-')) return;
    const touchId = Number(String(swipeState.key).slice(6));
    const touch = Array.from(event.changedTouches).find((item) => item.identifier === touchId);
    if (touch) finishDeleteSwipe(swipeState.key, touch.clientX);
  });
  notesList.addEventListener('touchcancel', () => {
    if (swipeState && String(swipeState.key).startsWith('touch-')) cancelDeleteSwipe(swipeState.key);
  });

  notesList.addEventListener('pointerdown', (event) => {
    const row = event.target.closest('.note-row');
    if (!row || event.pointerType === 'touch' || (event.pointerType === 'mouse' && event.button !== 0)) return;
    startDeleteSwipe(row, `pointer-${event.pointerId}`, event.clientX, event.clientY);
    try { row.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }
  });
  notesList.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    if (moveDeleteSwipe(`pointer-${event.pointerId}`, event.clientX, event.clientY)) event.preventDefault();
  });
  notesList.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'touch') finishDeleteSwipe(`pointer-${event.pointerId}`, event.clientX);
  });
  notesList.addEventListener('pointercancel', (event) => {
    if (event.pointerType !== 'touch') cancelDeleteSwipe(`pointer-${event.pointerId}`);
  });

  tg?.BackButton?.onClick(returnToList);
  window.addEventListener('pagehide', () => { if (hasUnsavedChanges) saveCurrentNote(); });

  async function init() {
    if (!cloudStorage) {
      renderTelegramOnlyMessage();
      return;
    }
    applyTelegramTheme();
    try {
      index = await loadIndex();
      renderList();
    } catch (error) {
      showNotice(`Хранилище недоступно: ${error.message}. Проверьте подключение к сети и повторите попытку.`, true);
      renderList();
    }
  }
  init();
})();
