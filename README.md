# Telegram Notes

A lightweight notes application built as a **Telegram Mini App** using vanilla JavaScript and the Telegram Web Apps API.

The application runs directly inside Telegram and stores user notes in **Telegram CloudStorage**, so it does not require a custom backend or external database.

## Features

- Create and edit notes
- Automatic saving while typing
- Notes stored in Telegram CloudStorage
- Notes sorted by last update time
- Delete notes from the editor
- Swipe left to delete notes from the list
- Telegram native confirmation dialogs
- Telegram BackButton integration
- Haptic feedback on mobile devices
- Automatic Telegram theme integration
- Save status and error handling
- Retry failed saves
- Empty state for new users
- Character limit handling
- Responsive mobile-first interface
- Works without a custom backend

## Tech Stack

- JavaScript
- HTML5
- CSS3
- Telegram Web Apps API
- Telegram CloudStorage API
- Web Storage-style asynchronous data architecture
- Touch Events
- Pointer Events

No frameworks, external state-management libraries or backend services are required.

## Architecture

The application is intentionally small and client-side only:

```text
Telegram
   │
   ▼
Telegram Mini App
   │
   ├── HTML
   ├── CSS
   └── JavaScript
          │
          ▼
Telegram Web Apps API
          │
          ▼
Telegram CloudStorage
```

## Data Storage

Notes are stored directly in Telegram CloudStorage.

The application keeps a lightweight index of available notes:

```text
notes_index
```

Each individual note is stored separately:

```text
note_<id>
```

A note contains:

```json
{
  "id": "note-id",
  "title": "Note title",
  "body": "Note content",
  "updatedAt": "2026-10-05T12:00:00.000Z"
}
```

The index stores only metadata required for displaying and sorting the notes list:

```json
{
  "id": "note-id",
  "title": "Note title",
  "updatedAt": "2026-10-05T12:00:00.000Z"
}
```

This avoids loading the full content of every note when opening the application.

## Autosave

Changes are automatically saved after the user stops typing.

```text
User input
    ↓
Unsaved changes
    ↓
650 ms debounce
    ↓
Save note
    ↓
Update notes index
```

The application displays the current state of the save operation:

```text
Changed
Saving...
Saved
Not saved
```

If saving fails, the note remains in the editor and the user can retry the operation.

Save operations also have a timeout to prevent the interface from remaining indefinitely in a saving state when Telegram CloudStorage is unavailable.

## Storage Consistency

When a note is saved, its content is written before its metadata is added to the notes index.

```text
Save note body
      ↓
Save index entry
      ↓
Update application state
```

This prevents the notes list from referencing a note that was never successfully stored.

Deletion from the notes list uses an optimistic UI update. If CloudStorage fails, the previous local index is restored.

## Telegram Integration

The application uses the Telegram Web Apps API for:

- CloudStorage
- theme colors
- native BackButton
- confirmation dialogs
- haptic feedback
- Mini App initialization
- expanding the application viewport

The interface automatically reads Telegram theme parameters:

```text
background
secondary background
text
hint text
button
button text
```

This allows the application to visually integrate with the active Telegram theme.

## Swipe to Delete

Notes can be deleted directly from the list using a left swipe gesture.

The interaction supports both:

- Touch Events for Telegram mobile clients
- Pointer Events for desktop and mouse interaction

Deletion is triggered only after the gesture crosses the required distance.

Moving the finger back before releasing cancels the action.

On supported devices, successful swipe deletion also triggers haptic feedback.

## Note Limits

Telegram CloudStorage limits the size of individual stored values.

To stay within this limitation, the application restricts note content to:

```text
Title: 160 characters
Body: 3500 characters
```

The editor warns the user when the body approaches the limit.

## Error Handling

The application handles failures during:

- loading the notes index
- loading individual notes
- saving
- deleting
- CloudStorage timeouts
- corrupted stored data

Errors are displayed directly in the UI instead of silently failing.

If a save fails, the text remains available in the editor so the user can retry without losing their changes.

## Telegram-only Mode

The application depends on Telegram CloudStorage.

If opened outside Telegram, it displays an informational screen instead of attempting to run with unavailable APIs.

```text
Open the application in Telegram
```

No fallback storage is used intentionally, keeping Telegram CloudStorage as the single source of persistence.
