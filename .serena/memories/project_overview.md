# VarManagerPlugin Overview
- Purpose: SillyTavern server plugin providing REST endpoints for persisting conversation variable snapshots and templates in SQLite.
- Stack: Node 22+, TypeScript, Express, body-parser, Zod for validation, built-in `node:sqlite`. Bundled with webpack for single-file deployment.
- Structure: `src/` contains config/logger/util/db modules; `db/` handles SQLite connection, schema, value/template/snapshot logic; build output is `dist/index.js` referenced by `package.json` main entry.
- Deployment: copy built folder into SillyTavern `plugins/` directory; database stored under plugin `data/` or `SILLYTAVERN_DATA_DIR`.