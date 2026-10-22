# Custom Android Build Platform

## Truthful capability state

The platform now has a real authenticated API, durable local job state, idempotent submission, a durable file-backed development queue, worker registration records, capability checks, fixed-command worker execution, artifact validation, checksum calculation, expiry metadata, and authorized artifact streaming.

The Windows desktop client remains an orchestrator. It does not compile AOSP in the renderer or native Windows process. Remote controls are enabled only when both `OCTO_BUILD_API_URL` and `OCTO_BUILD_API_TOKEN` are present in the Electron main-process environment. Without them, the Devices tab remains local configuration/export only.

A job reaches `SUCCEEDED` only after a worker has:

1. Passed the real Linux, architecture, disk, RAM, Git, Repo, Python, and Java checks.
2. Executed the allowlisted AOSP workflow.
3. Produced the expected `emu_img_zip.zip`.
4. Passed ZIP structure and archive-traversal validation.
5. Had its SHA-256 calculated.
6. Copied the validated artifact into storage.
7. Persisted artifact metadata.

A Windows host, WSL2 host, or Docker host is never reported as an AOSP worker unless the selected Linux environment passes the same capability checks.

## Local development

```powershell
Copy-Item services/android-build/.env.example services/android-build/.env
# Edit .env and provide unique local-only tokens.
$env:OCTO_BUILD_API_TOKENS = 'a-long-local-user-token'
$env:OCTO_BUILD_WORKER_TOKEN = 'a-long-local-worker-token'
npm run build:android-build-platform
npm run start:android-build-api
```

Run the worker in another terminal:

```powershell
npm run start:android-build-worker
```

On Windows, the local worker will normally report `UNAVAILABLE` because the AOSP worker requires Linux. This is expected and truthful. The Windows host inspection helpers identify WSL2 and Docker Desktop without executing arbitrary user commands; a production launcher must connect those checks to a controlled Linux worker image/distribution.

Docker development configuration is at `services/android-build/docker-compose.yml`. It uses a named volume and requires explicit tokens through `.env`. The included worker still refuses to claim a build unless its container is a supported, sufficiently provisioned Linux environment.

Reset local development state by stopping the services and removing the configured store and artifact/work directories. Do not use reset commands against production storage.

## API

- `GET /health`
- `GET /ready`
- `POST /api/v1/android-builds`
- `GET /api/v1/android-builds`
- `GET /api/v1/android-builds/:jobId`
- `POST /api/v1/android-builds/:jobId/cancel`
- `POST /api/v1/android-builds/:jobId/retry`
- `GET /api/v1/android-builds/:jobId/events`
- `GET /api/v1/android-builds/:jobId/artifacts`
- `GET /api/v1/android-builds/:jobId/artifacts/:artifactId`
- `POST /api/v1/workers`

User endpoints require `Authorization: Bearer <configured user token>`. Build creation requires an `Idempotency-Key`. Worker registration requires the separate `OCTO_BUILD_WORKER_TOKEN`.

The local API uses a durable JSON store for development. It is not a production database or multi-instance deployment. A production deployment must replace the store with a transactional database and queue adapter before exposure beyond localhost.

## Production requirements

A real deployment needs a persistent authenticated service, transactional database, durable queue, TLS, secret injection, worker leases/heartbeats, object storage, backups, quotas, monitoring, and a supported Linux host. No production credentials, signing keys, cloud endpoints, or private storage keys are included in this repository.

Level 4 is not claimed from this Windows sandbox. The exact remaining verification requires a supported 64-bit Linux worker or provisioned WSL2/Docker Linux environment with approximately 400 GB free disk, approximately 64 GB RAM, AOSP dependencies, source access, a completed build, validated artifact storage, and an authorized download test.
