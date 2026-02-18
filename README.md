# Guitar Practice App

Implementation based on:
- `PROJECT_PLAN.md`
- `API_SPEC_V1.md`

## Stack
- Frontend: React + Vite + TypeScript
- API: Cloudflare Workers
- DB: Cloudflare D1 (SQLite)

## Run locally
1. Install packages
```bash
npm install
```
2. Create D1 database and update `wrangler.toml` `database_id`
```bash
wrangler d1 create guitar_practice_db
```
3. Apply schema and seed data
```bash
npm run db:migrate:local
npm run db:seed:local
```
4. Start both frontend and worker
```bash
npm run dev:all
```

Alternative (two terminals):
```bash
npm run dev:worker
npm run dev
```

PowerShell note:
- If `npm` is blocked by execution policy, run `npm.cmd` instead (for example: `npm.cmd run dev:all`).

## Project layout
- `src/features/*`: feature modules (`types.ts`, `service.ts`, `api.ts`, `ui/*`)
- `src/shared/*`: shared API/types
- `worker/routes/*`: feature-based route handlers
- `db/migrations/*`: D1 migrations
- `db/seed/*`: deterministic seed SQL

## Deployment
1. Apply remote migrations
```bash
npm run db:migrate:remote
```
2. Seed minimal production data (optional)
```bash
npm run db:seed:remote
```
3. Deploy worker
```bash
npm run deploy:worker
```
