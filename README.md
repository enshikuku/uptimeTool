# ⚡ Uptime Monitor

A lightweight, zero-dependency uptime monitor powered by **GitHub Actions** and **GitHub Pages**.

- Checks HTTP(S) endpoints and TCP ports every 5 minutes
- Static dashboard — no backend required
- Alerts via **Telegram** or **GitHub Issues** on state transitions (UP → DOWN and DOWN → UP)

---

## Repo Structure

```
.github/workflows/uptime.yml   # Scheduled checker workflow
scripts/checks.js               # Node.js checker (zero deps)
docs/
  status.json                    # Written by the workflow
  index.html                     # Dashboard page
  style.css                      # Dashboard styles
  app.js                         # Fetches status.json & renders
```

---

## Setup

### 1. Enable GitHub Pages

1. Go to **Settings → Pages** in your repo.
2. Set **Source** to `Deploy from a branch`.
3. Set **Branch** to `main` and folder to `/docs`.
4. Save. Your dashboard will be at `https://<user>.github.io/<repo>/`.

### 2. Set GitHub Secrets

Go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret               | Purpose                                      |
|-----------------------|----------------------------------------------|
| `ALERT_METHOD`        | `telegram`, `github-issue`, or `none` (default: `telegram`) |
| `TELEGRAM_BOT_TOKEN`  | Your Telegram bot token from @BotFather      |
| `TELEGRAM_CHAT_ID`    | Chat ID to send alerts to                    |

> `GITHUB_TOKEN` is provided automatically — no setup needed.  
> If you use `github-issue` as the alert method, no extra secrets are required.

### 3. Change Monitored Targets

Edit the `TARGETS` array in [`scripts/checks.js`](scripts/checks.js):

```js
const TARGETS = [
  { type: "url",  name: "My Site",   target: "https://example.com" },
  { type: "tcp",  name: "My Server", target: "1.2.3.4:22" },
];
```

- `type: "url"` — HTTP(S) GET with 10 s timeout
- `type: "tcp"` — TCP connect with 5 s timeout

Push your changes and the workflow picks them up on the next run.

### 4. Manual Trigger

Go to **Actions → Uptime Checks → Run workflow** to trigger a check immediately.

---

## Test Locally

```bash
# No install needed — uses only Node.js built-ins
node scripts/checks.js
```

This writes `docs/status.json`. Open `docs/index.html` in a browser to see the dashboard (you may need a local server for fetch to work):

```bash
npx serve .
```

---

## Alerting

Alerts fire only on **state transitions**:

- **UP → DOWN** — sends a 🔴 DOWN alert with the target name, error, and timestamp.
- **DOWN → UP** — sends a 🟢 RECOVERED alert.

Repeated failures do **not** send duplicate alerts.

### Switching alert method

Set the `ALERT_METHOD` secret (or env var) to one of:

| Value          | Behavior                             |
|----------------|--------------------------------------|
| `telegram`     | Sends Markdown message via Bot API   |
| `github-issue` | Opens an issue with the `uptime-alert` label |
| `none`         | Logs to console only                 |

---

## License

MIT
