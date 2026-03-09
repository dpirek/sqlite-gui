# SQLite GUI (Electron + Node.js)

Simple desktop app for opening local SQLite files, running SQL, and viewing results in a table.

## Run

```bash
npm install
npm start
```

## Features

- Open local `.db`, `.sqlite`, `.sqlite3` files
- View tables in sidebar
- Click table names to prefill query
- Run `SELECT`, `PRAGMA`, `WITH`, and write queries (`INSERT`, `UPDATE`, `DELETE`, etc.)
- See row results or mutation summary
- Run query with `Ctrl+Enter` (or `Cmd+Enter` on macOS)
- Uses Node's built-in `node:sqlite` module (no external SQLite npm package)
- Quick edit mode: click a cell in a table loaded from the left nav to edit and save inline

## Notes

- This app runs SQL directly against your selected local file.
- Use with trusted SQL and consider backups before write operations.
- Requires a Node/Electron runtime that exposes `node:sqlite`.
- Inline quick edit currently applies to data grids opened via the left table list (`SELECT * ... LIMIT 100` preview path).
