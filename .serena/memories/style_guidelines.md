# Style & Conventions
- TypeScript with `strict` compiler options; prefer async/await and explicit interfaces.
- Logging via `logger.ts` (`log`, `warn`, `error`) with localized Chinese messages.
- Database access encapsulated in `src/db/*` modules; statements prepared via `node:sqlite` and transactions handled manually.
- Serialization utilities in `util/serialization.ts`; maintain deterministic JSON ordering for storage.
- Minimize inline comments—only add clarifying notes for non-obvious logic.