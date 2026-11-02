# RideMate

RideMate is a carpool matching platform for verified university students (USIU-Africa pilot).

| Folder | What it is |
|---|---|
| `client/` | React + Vite + Tailwind CSS v4 web app |
| `server/` | Node.js + Express REST API |
| `matcher/` | Python 3.12 + FastAPI matching engine (Sprint II) |
| `db/` | Numbered SQL migrations, seed data, and the Docker init script |

## Prerequisites (Windows, PowerShell)

```powershell
winget install --id Docker.DockerDesktop -e
winget install --id Python.Python.3.12 -e
winget install --id EclipseAdoptium.Temurin.21.JDK -e   # needed by the Firebase Auth Emulator
# Node.js 20+ is required (tested on Node 24)
```

Start Docker Desktop once after installing it. If Windows asks you to restart, do so before continuing, because Docker uses WSL2.

## Quick start

_Full steps are added at the end of Sprint I._
