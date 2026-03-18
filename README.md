# Twitch Subathon Timer

A real-time Twitch subathon timer with Streamlabs Socket API integration.
It provides a browser control panel, live timer updates, persistent state, and event-based time additions for subs, gifts, bombs, and bits.

## Tech Stack

- Backend: Node.js (ES modules), Socket.IO, Socket.IO client, dotenv
- Frontend: Vanilla HTML, CSS, JavaScript
- Realtime: Socket.IO between browser and backend
- Persistence: JSON files on disk

## Project Layout

- `backend/server.js` - main server, Streamlabs event handling, timer logic
- `backend/.env.example` - environment variable template
- `backend/timer-state.json` - persisted state and settings
- `backend/timer.txt` - current timer value (`H:MM:SS`) for overlays (for example OBS text source)
- `frontend/index.html` / `frontend/script.js` / `frontend/style.css` - control UI
- `start.bat` - Windows quick start

## Requirements

- Node.js 18+ recommended
- A valid Streamlabs Socket API token for live event ingestion

## Environment Setup (Important)

`backend/.env.example` is only a template and must not contain real secrets.

1. Create a production/local env file from the template:
   - Copy or rename `backend/.env.example` to `backend/.env`
2. Set your token in `backend/.env`:

```env
STREAMLABS_TOKEN=your_streamlabs_socket_token
```

Notes:
- Do not commit `backend/.env`.
- In production, use only `backend/.env` with real values.
- If `STREAMLABS_TOKEN` is missing, the app still runs, but Streamlabs events are disabled.

## Installation

```powershell
cd backend
npm install
```

## Run

Option A (Windows helper):

```powershell
.\start.bat
```

Option B (manual):

```powershell
cd backend
npm start
```

Then open: `http://localhost:3000`

## Timer Logic

- Timer starts paused after server start/restart.
- While running, it counts down every second.
- At `0`, the timer auto-stops.
- State updates are pushed live to the frontend via Socket.IO.

### Event Mapping

- `subscription` (`sub`, `resub`):
  - Adds 1 sub and tier-based seconds (`primeT1`, `t2`, `t3`)
- `subscription` (`subgift`, `gift_sub`):
  - Adds 1 sub and tier-based seconds
  - Child gifts linked to an active mystery gift are ignored to avoid double counting
- `subscription` (`community_gift`) and `subMysteryGift`:
  - Adds `gift_count * tier_seconds`
  - Adds optional bomb bonus only for exact bomb sizes: `10`, `20`, `50`, `100`
  - Increments sub-bomb counter only for those exact bomb sizes
- `bits`:
  - Tracks all bits in totals
  - Adds time only for full 100-bit chunks (`floor(bits / 100) * secondsPer100Bits`)

### Happy Hour Rules

- Happy Hour doubles:
  - sub tier add time (`primeT1`, `t2`, `t3`)
  - bits add time
- Happy Hour does **not** double bomb bonus time.

### Reliability Rules

- Duplicate protection:
  - Event-ID dedupe window: 24h
  - Fingerprint dedupe window: 15s fallback
- State persistence:
  - Timer state and settings are saved to `backend/timer-state.json`
- Overlay output:
  - Current timer is written continuously to `backend/timer.txt`

## Logging

- Structured one-line logs with tags and key/value fields
- Duplicate events are logged as ignored
- Unmapped events are silent
- Follow events are logged as informational (`follow`, `user`)
