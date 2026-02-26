(function () {
  "use strict";

  const STATUS_URL = "../status.json";
  const REFRESH_INTERVAL = 30_000; // 30 seconds

  const $lastChecked = document.getElementById("last-checked");
  const $targets = document.getElementById("targets");

  function relativeTime(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  function renderTargets(data) {
    $lastChecked.textContent = "Last checked: " + new Date(data.lastRunUtc).toLocaleString() + " (" + relativeTime(data.lastRunUtc) + ")";

    $targets.innerHTML = "";

    for (const t of data.targets) {
      const card = document.createElement("div");
      card.className = "card " + (t.ok ? "up" : "down");

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = t.ok ? "UP" : "DOWN";

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = t.name;

      const meta = document.createElement("span");
      meta.className = "meta";
      const parts = [];
      if (t.status != null) parts.push("HTTP " + t.status);
      if (t.ms != null) parts.push(t.ms + " ms");
      if (t.error) parts.push(t.error);
      meta.textContent = parts.join(" · ");

      const target = document.createElement("span");
      target.className = "target";
      target.textContent = t.target;

      card.appendChild(badge);
      card.appendChild(name);
      card.appendChild(target);
      card.appendChild(meta);
      $targets.appendChild(card);
    }
  }

  async function fetchStatus() {
    try {
      const res = await fetch(STATUS_URL + "?_=" + Date.now());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      renderTargets(data);
    } catch (err) {
      $lastChecked.textContent = "Failed to load status: " + err.message;
    }
  }

  fetchStatus();
  setInterval(fetchStatus, REFRESH_INTERVAL);
})();
