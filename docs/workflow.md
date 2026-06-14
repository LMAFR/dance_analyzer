# Branching & deploy workflow

## Branches
- **`dev`** — active development. All changes start here.
- **`main`** — production. **The live site https://sk-arn.com is built and deployed
  from `main`.**

The point of the split: changes can be tested **locally** from `dev` before they
reach the live domain. Nothing on `dev` is served to the public until it's merged
into `main` and `main` is deployed.

## Day-to-day flow
1. Make changes on **`dev`**.
2. Verify locally:
   ```bash
   # frontend (Vite dev server, proxies /api to the backend)
   cd frontend && npm run dev
   # backend (in another shell)
   cd backend && uvicorn app.main:app --reload --port 8008
   ```
   Or do a production build check: `cd frontend && npx tsc -b && npm run build`.
3. Commit + push `dev`.
4. Open a PR **`dev` → `main`** and merge once the changes are approved.
5. **Deploy `main`** (below).

## Deploy `main` to the domain
Run on the VPS, in the repo root:
```bash
git checkout main && git pull        # get the merged changes
docker-compose build web             # rebuild the SPA image (and backend if it changed)
docker-compose down && docker-compose up -d   # recreate (compose v1.29 quirk)
```
Then verify:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sk-arn.com/   # 200
curl -s https://sk-arn.com/api/health                          # {"ok":true}
curl -s https://sk-arn.com/ | grep -o '/assets/index-[^"]*\.js' # new bundle hash
```

Notes:
- The live containers run the **built image**, so once `main` is built and `up`, the
  site serves `main` regardless of which branch the working tree is later checked out
  to. You can switch back to `dev` to keep working without affecting the live site.
- compose here is **v1.29** — always recreate with `down && up -d` (a plain `up -d`
  recreate can raise `KeyError: 'ContainerConfig'`). Named volumes (`dd_data`)
  persist across recreations.
- nginx on the VPS owns 80/443 and proxies the `sk-arn.com` vhost to `localhost:8090`
  (the compose `web` service).
