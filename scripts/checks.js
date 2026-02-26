/**
 * Uptime checker script — runs HTTP(S) and TCP checks, writes status.json,
 * and sends alerts on state transitions.
 *
 * Zero external dependencies — uses only Node.js built-ins.
 */

const https = require("https");
const net = require("net");
const fs = require("fs");
const path = require("path");

// ─── Configuration ──────────────────────────────────────────────────────────

const TARGETS = [
  // HTTP/HTTPS sites
  { type: "url", name: "AIMHub Lighthouses", target: "https://aimhublighthouses.uoeld.ac.ke" },
  { type: "url", name: "AIMHub API", target: "https://aimhub-api.duckdns.org/" },
  { type: "url", name: "FlycationKE", target: "https://flycationke.duckdns.org/" },
  { type: "url", name: "FlycationKE API", target: "https://flycationke-api.duckdns.org/" },
  { type: "url", name: "Pathle Consultants", target: "https://pathleconsultants.duckdns.org/" },
  { type: "url", name: "Bikexify App", target: "https://app.bikexify.co.ke" },
  { type: "url", name: "Bikexify API", target: "https://api.bikexify.co.ke" },
  { type: "url", name: "Bikexify", target: "https://bikexify.co.ke" },

  // TCP port checks
  { type: "tcp", name: "Denmark SSH", target: "193.181.211.219:22" },
  { type: "tcp", name: "UoE SSH", target: "41.89.169.160:9160" },
];

const HTTP_TIMEOUT_MS = 10_000;
const TCP_TIMEOUT_MS = 5_000;

// Alert method: "telegram" | "github-issue" | "none"
const ALERT_METHOD = process.env.ALERT_METHOD || "telegram";

const STATUS_FILE = path.resolve(__dirname, "..", "docs", "status.json");

// ─── Checkers ───────────────────────────────────────────────────────────────

async function checkUrl(target) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    // Consume body to release resources
    await res.text();
    const ms = Date.now() - start;
    return { ok: res.status < 500, status: res.status, ms, finalUrl: res.url };
  } catch (err) {
    clearTimeout(timer);
    const ms = Date.now() - start;
    const error = err.name === "AbortError" ? "Timeout" : err.message;
    return { ok: false, status: null, ms, error };
  }
}

function checkTcp(host, port) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new net.Socket();
    sock.setTimeout(TCP_TIMEOUT_MS);
    sock.once("connect", () => { sock.destroy(); resolve({ ok: true, ms: Date.now() - start }); });
    sock.once("timeout", () => { sock.destroy(); resolve({ ok: false, ms: Date.now() - start, error: "Timeout" }); });
    sock.once("error", (err) => { sock.destroy(); resolve({ ok: false, ms: Date.now() - start, error: err.message }); });
    sock.connect(Number(port), host);
  });
}

// ─── Alerting ───────────────────────────────────────────────────────────────

async function sendTelegramAlert(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("Telegram secrets not set — skipping alert");
    return;
  }

  const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" });

  return new Promise((resolve) => {
    const req = https.request(
      `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => { res.resume(); res.on("end", resolve); }
    );
    req.on("error", (e) => { console.error("Telegram error:", e.message); resolve(); });
    req.end(body);
  });
}

async function createGitHubIssue(title, body) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // owner/repo
  if (!token || !repo) {
    console.warn("GitHub token/repo not available — skipping issue creation");
    return;
  }

  const payload = JSON.stringify({ title, body, labels: ["uptime-alert"] });
  const options = {
    hostname: "api.github.com",
    path: `/repos/${repo}/issues`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "User-Agent": "uptime-monitor",
      Accept: "application/vnd.github+json",
    },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => { res.resume(); res.on("end", resolve); });
    req.on("error", (e) => { console.error("GitHub issue error:", e.message); resolve(); });
    req.end(payload);
  });
}

async function sendAlert(target, result, timestamp) {
  const msg = `🔴 *DOWN* — ${target.name}\nTarget: \`${target.target}\`\nError: ${result.error || `HTTP ${result.status}`}\nTime: ${timestamp}`;

  if (ALERT_METHOD === "telegram") {
    await sendTelegramAlert(msg);
  } else if (ALERT_METHOD === "github-issue") {
    await createGitHubIssue(`🔴 DOWN: ${target.name}`, msg);
  } else {
    console.log("Alert (no handler):", msg);
  }
}

async function sendRecoveryAlert(target, result, timestamp) {
  const msg = `🟢 *RECOVERED* — ${target.name}\nTarget: \`${target.target}\`\nResponse: ${result.ms}ms\nTime: ${timestamp}`;

  if (ALERT_METHOD === "telegram") {
    await sendTelegramAlert(msg);
  } else if (ALERT_METHOD === "github-issue") {
    await createGitHubIssue(`🟢 RECOVERED: ${target.name}`, msg);
  } else {
    console.log("Recovery (no handler):", msg);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Load previous state
  let previousState = {};
  if (fs.existsSync(STATUS_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
      for (const t of prev.targets || []) {
        previousState[t.target] = t.ok;
      }
    } catch { /* first run */ }
  }

  const timestamp = new Date().toISOString();
  const results = [];

  for (const t of TARGETS) {
    let result;
    if (t.type === "url") {
      result = await checkUrl(t.target);
    } else if (t.type === "tcp") {
      const [host, port] = t.target.split(":");
      result = await checkTcp(host, port);
    }

    const entry = { type: t.type, name: t.name, target: t.target, ok: result.ok };
    if (result.status !== undefined) entry.status = result.status;
    entry.ms = result.ms;
    if (result.error) entry.error = result.error;
    results.push(entry);

    const wasOk = previousState[t.target];
    // Alert on UP -> DOWN transition
    if (wasOk === true && !result.ok) {
      console.log(`ALERT: ${t.name} went DOWN`);
      await sendAlert(t, result, timestamp);
    }
    // Notify on DOWN -> UP recovery
    if (wasOk === false && result.ok) {
      console.log(`RECOVERY: ${t.name} is back UP`);
      await sendRecoveryAlert(t, result, timestamp);
    }

    const icon = result.ok ? "✅" : "❌";
    console.log(`${icon} ${t.name} — ${result.ok ? "UP" : "DOWN"} (${result.ms}ms)`);
  }

  const output = { lastRunUtc: timestamp, targets: results };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nStatus written to ${STATUS_FILE}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
