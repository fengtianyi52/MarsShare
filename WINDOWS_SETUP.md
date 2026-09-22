# MarsShare Windows Setup

## Installed tools

- Go: `E:\develop\Go`
- Docker Desktop application: `C:\Program Files\Docker\Docker`
- Docker installer archive: `E:\develop\Docker\DockerDesktopInstaller.exe`
- WSL2 installer and log: `E:\develop\WSL`
- Docker Desktop user configuration: `E:\develop\DockerConfig`
- Docker Desktop local cache: `E:\develop\DockerLocal`
- Node.js and npm already available at `E:\develop\node`

## Local development

From `D:\Desktop\codex_project\MarsShare`:

```powershell
docker compose up --build
```

Open:

- Web: http://localhost:5173
- API: http://localhost:8080/api
- Health check: http://localhost:8080/healthz
- Mailpit when enabled: http://localhost:8025

The first startup creates the PostgreSQL schema and bootstraps the administrator
from `.env`. Change the bootstrap password before exposing the service to the
public internet.

## Production deployment

1. Copy the project to a Linux server or a Windows server with Docker Desktop.
2. Replace the values in `.env`, especially `APP_MASTER_KEY`, database password,
   admin password, `APP_BASE_URL`, and `CORS_ORIGIN`.
3. Point `APP_BASE_URL` and `CORS_ORIGIN` at the public HTTPS domain.
4. Configure TLS at the reverse proxy or cloud load balancer.
5. Start the production stack:

```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

The production gateway serves the built React application and proxies `/api/`
and `/healthz` to the Go API.

## Feature coverage

MarsShare includes:

- user registration, login, refresh tokens, profiles, and password changes
- public and following feeds
- Markdown posts, post editing, revisions, comments, likes, reposts, follows,
  topics, reports, and full-text search
- local file uploads, folders, trash, previews, downloads, post attachments,
  sharing links, and file transfer
- notifications, memberships, wallet/redeem flows, Stripe integration hooks,
  and an administrator console
