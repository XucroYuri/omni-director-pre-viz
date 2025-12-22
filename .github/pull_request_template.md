## Checklist
- [ ] Does not add/modify any secrets (API keys, tokens) in code, configs, logs, or URLs
- [ ] Does not change locked files (model/provider IDs) unless maintainer-approved
- [ ] Keeps “single grid render + physical slicing” strategy intact
- [ ] Updates `dev/` docs if behavior/UX changes

## Compliance Check (Docs-as-Gates)
- [ ] Dependencies structured per `rules.md` and `.trae/rules/rules.deps.globs.md`
- [ ] Renderer boundary respected per `.trae/rules/rules.globs.md` (no Node/Electron + no provider SDKs)
- [ ] If touching locked areas: add label `maintainer-approved` (maintainer-only; otherwise `Locked Files Guard` will fail)

## What changed?
Describe the change succinctly.

## How to verify?
Steps to test (manual or automated).
