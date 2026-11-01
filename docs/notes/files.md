# Files explorer (D67, D68)

Browse, open, edit and hand off files of a project, on the desktop and on phones.

## Where it shows

- **Desktop**: the folder icon in the workspace bar opens a Files pane (focuses an existing one,
  fills an empty pane, else splits right). Pane kind `files` (`PaneContent::Files { path, file? }`)
  stays in the layout. Two columns from 620 px pane width, one below; arrow keys, Enter,
  Backspace / ⌘↑ go up.
- **Phones**: project page → Files. Each folder and file is a router page (`#/files/<ws>/<path>`,
  `#/file/<ws>/<path>`), so Android back and browser back walk up. With home access on, the
  Projects list has "Home folder" (`ws` = `home`, path `~`).
- Offered only when the daemon lists `"files"` in `HelloOk.features` (`useFilesSupported`). Older
  daemons closed relay sessions on unknown requests, so there is no probe.

## Daemon (`crates/na-daemon/src/files.rs`)

| Request | What it does |
| --- | --- |
| `file_list {path, hidden}` | One folder: entries (folders first), git status per entry, `protected` marks, `truncated` over 5000. |
| `file_read {path, offset, len?}` | One piece, base64, 512 KiB default, 1 MiB max; `text`, `mime`, `mtime`, `eof`. |
| `file_save {path, text, mtime?}` | Atomic write (temp + rename). A newer mtime on disk → `conflict`. |
| `file_upload {dir, name, id, offset, data, last, size?}` | Pieces into `.na-upload-<id>.part`, renamed at the end to a free (numbered) name. Refused when the rest of the file would leave less than 1 GB free on the computer's disk (`MIN_FREE`, `statvfs`; checked on every piece, `size` lets the first piece check the whole file). |
| `file_search {path, query}` | Names below a folder (skips `node_modules`, `.git`, `target`, …), capped. |

- **Roots** (`roots()`): desktop gets all workspaces and Home; Web/Android only approved
  workspaces, plus Home read-only when `Settings.remote_files_home` is on; the orchestrator gets
  nothing. Roots are kept both canonical and by their saved spelling (`/tmp` vs `/private/tmp`).
- **Path checks** (`resolve()`): `~` expands to home; the lexical path must be inside a root, then
  the canonical path must be inside a root too (symlinks out are refused). Through the read-only
  home root (phones) `off_limits()` also refuses key folders (`SECRET`: `.ssh`, `.gnupg`, `.aws`,
  `.config`, …) and on macOS the `PROTECTED` folders, compared by name (any case) and by the
  folder's identity on disk (so `~/documents`, `~/.ſsh` on a case-insensitive disk, or a link to
  them are caught). Reads check that the opened file is still the checked one (no link swapped in).
- **Trust**: the switch is a default, not a wall. Remote clients are the owner's own devices (D42):
  they may add any folder as a project (approved at once) and start a shell there. Narrowing that
  is a policy change in `policy.rs` / `workspace_add`, not in Files.
- **Big folders**: names are read and sorted first (no stat), then cut to 5000 and stat'ed, so the
  folders and first names survive; the app draws 400 rows and "Show all" for the rest.
- **Text**: the daemon calls a file text when it is UTF-8, UTF-16 (byte-order mark, or every other
  byte zero) or a one-byte code page (no NUL, under 1 % control characters). The app decodes UTF-8
  strictly and edits it; UTF-16 and, as the fallback, Latin-1 (Windows-1252) are decoded for
  reading only ("UTF-16LE, read-only", "Latin-1, read-only"), since a save writes UTF-8. A BOM is kept and CRLF files are saved with CRLF. Paths typed into a terminal
  ("Send to agent") lose control characters and are shell-quoted (`termToken`). Upload names lose
  control and direction marks.
- **macOS privacy**: a listing never looks inside child folders. Desktop, Documents, Downloads,
  Library, Movies, Music and Pictures in Home are `protected`: shown, opened only when tapped.
  Without Full Disk Access a phone cannot open a workspace inside a folder macOS guards until
  macOS has answered for it (`permissions::Gate`; the root is kept unresolved, `Root.shut`, and
  every request answers "Needs Full Disk Access on the Mac"). See `system-integration.md`.
- **Downloads** from the file menu show progress with a Cancel button; cancelling stops asking for
  pieces (`AbortSignal` through `readWhole`).
- **Who changes the switch**: `settings_set` from a non-desktop client keeps the old
  `remote_files_home` (`core.rs`, SettingsSet arm). The switch is in Settings → Remote access
  (`components/files/HomeAccess.tsx`).
- **Audit**: remote `file_read` (offset 0), `file_save`, `file_upload` (last piece or failure) go to
  `audit.jsonl`; `file_list` and `file_search` are skipped.

## App (`packages/app/src/components/files/`)

- `model.ts`: kinds, languages, sizes, crumbs, limits (`PREVIEW_BYTES` 512 KiB, `MAX_TEXT` 4 MiB,
  `MAX_MEDIA` 48 MiB, `CHUNK` 512 KiB). `highlight.ts`: small tokenizer → `.fv-*` classes
  (`code.css`, colours via `color-mix` of system tokens).
- `hooks.ts`: `useFolder` (cache of 60 listings), `useFileSearch` (debounced), `useFile` (first
  piece, "load all", blob for media and downloads).
- `FolderView.tsx` (toolbar: search, sort, hidden, add files, refresh; phone rows and compact desk
  rows), `FileViewer.tsx` (viewer + editor, `ViewerChrome` render prop), `FilesPane.tsx` (desktop),
  `PhoneFiles.tsx` (phone pages), `actions.tsx` (per-file menu), `send.ts` (send a path to an
  agent: Claude chat composer via `na-insert-text`, else `term_write`).
- Platform: `openPath` / `revealPath` (desktop, opener plugin), `shareFile` (Android native, new
  APK needed); the web falls back to a blob download or `navigator.share`.

## Checks

- `cargo test -p na-daemon files::`, `packages/app/src/lib/files.test.ts`.
- Screens: `node scripts/dev/scenes/files.mjs --make <home>` then
  `node scripts/dev/shot.mjs files [folder code md big image binary pdf search home]`
  (`home` needs the switch on and `--hash "&web=1"`).
