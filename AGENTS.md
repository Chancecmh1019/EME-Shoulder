# EME Studio 2.0

- EME-Shoulder is the sole writable application. Four upstream ZIPs are read-only research; never commit archives or extracted code. Preserve AGPL and third-party notices.
- Work on `feat/eme-studio-2` (or isolated equivalent). No push, production deployment, main merge, paid provisioning, irreversible migrations, or real YouTube upload without explicit owner approval.
- Read `docs/EME_STUDIO_2_PLAN.md` and `docs/TEST_REPORT.md` before continuing. Report verified behavior separately from mocks and external prerequisites. UI and owner handoff use Traditional Chinese (Taiwan).
- Preserve `services/scene.ts`, `services/background.ts`, CD-Booklet fidelity, MV/SRT, Threads and legacy recovery until replacements pass regression checks.
- Never edit the literal or bytes of `utils/translationPrompts.ts`. Translation packages read the current LRC prompt, hash it, preserve source text/timing and reject stale submissions.
- Line-level LRC only; one serialization-only `[00:00.000]`, no phantom displayed lyric. Provider translations never enter Dot packages.
- Keep server modules out of browser imports. Authenticate and authorize all job/asset operations; protect cookie mutations from CSRF. Never expose Google tokens to new Studio routes. No arbitrary URL proxy or unsupported audio downloader.
- Run `npm test`, `npm run check`, `npm run build` after milestones. Record environmental failures exactly. Synthetic fixtures do not prove Dot/cloud/YouTube integration.
- SQLite and filesystem storage are local development adapters only, explicitly disabled on serverless hosts. PostgreSQL/S3 and actual Dot render validation remain release gates.
