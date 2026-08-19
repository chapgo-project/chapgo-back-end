# ChapGo backend deployment

This directory is the independent TypeScript backend service. The existing
`../chapgo_api` is only a reference and is not used by these npm scripts.

From this directory, `npm install`, `npm run build`, `npm start`, and `npm run
dev` use this service's own source and build output.

## Render

Create a **Web Service** from the GitHub repository with:

- Environment: `Docker`
- Root directory: `chapgo-back-end` (when using the monorepo)
- Dockerfile path: `Dockerfile`
- Docker build context: `chapgo-back-end`

Render provides `PORT`; the API already binds to `0.0.0.0` and uses that value.
Add the values from `chapgo_api/.env` as Render environment variables, including
at least `MONGO_URI`. Do not commit the local `.env` file.

The backend can also be deployed as its own GitHub repository with the root
directory left empty. `chapgo_api` is not required by this service.