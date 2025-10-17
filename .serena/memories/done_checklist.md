# Completion Checklist
- Reinstall dependencies if `package.json` changes (`npm install`).
- Run `npm run build` to ensure `dist/index.js` regenerates without errors.
- If relevant, copy updated plugin into SillyTavern `plugins/` folder and restart the server to verify logs show `[VarManagerPlugin]` startup.
- Optionally check generated database under `data/var-manager.db` for expected tables/rows when testing changes.