(function dashboardBootstrap() {
  const checkNowButton = document.getElementById('checkNowButton');
  const checkNowSpinner = document.getElementById('checkNowSpinner');
  const checkNowLabel = document.getElementById('checkNowLabel');
  const totalTargetsValue = document.getElementById('totalTargets');
  const totalUpValue = document.getElementById('totalUp');
  const totalDownValue = document.getElementById('totalDown');
  const uptimePercentageValue = document.getElementById('uptimePercentage');
  const lastUpdatedValue = document.getElementById('lastUpdated');
  const nextCheckCountdownValue = document.getElementById('nextCheckCountdown');
  const cycleDurationValue = document.getElementById('cycleDuration');
  const completedCyclesValue = document.getElementById('completedCycles');
  const websitesCountBadge = document.getElementById('websitesCountBadge');
  const serversCountBadge = document.getElementById('serversCountBadge');
  const websitesGrid = document.getElementById('websitesGrid');
  const serversGrid = document.getElementById('serversGrid');
  const emptyState = document.getElementById('emptyState');

  const initialStateElement = document.getElementById('initial-results');
  const statusMap = new Map();
  const checkIntervalMs = Number(document.body.dataset.checkIntervalMs) || 15_000;

  let results = readInitialResults();
  let isManualCheckPending = false;
  let isStatusFetchPending = false;

  function readInitialResults() {
    if (!initialStateElement) {
      return createEmptyResults();
    }

    try {
      const parsed = JSON.parse(initialStateElement.textContent);
      return normalizeResults(parsed);
    } catch (error) {
      console.error('Failed to parse initial monitor state.', error);
      return createEmptyResults();
    }
  }

  function createEmptyResults() {
    return {
      isChecking: false,
      lastRun: null,
      nextRun: null,
      totalChecks: 0,
      uptimePercentage: 0,
      lastSuccessTime: null,
      lastFailureTime: null,
      checkDurationMs: null,
      summary: {
        totalTargets: 0,
        totalUp: 0,
        totalDown: 0,
      },
      targets: [],
    };
  }

  function normalizeResults(data) {
    const fallback = createEmptyResults();
    if (!data || typeof data !== 'object') {
      return fallback;
    }

    return {
      ...fallback,
      ...data,
      summary: {
        ...fallback.summary,
        ...(data.summary || {}),
      },
      targets: Array.isArray(data.targets) ? data.targets : [],
    };
  }

  function toLocalDateTime(value) {
    if (!value) {
      return 'Waiting for first check';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Invalid date';
    }

    return date.toLocaleString();
  }

  function toDuration(value) {
    if (typeof value !== 'number') {
      return '--';
    }
    return `${value.toLocaleString()} ms`;
  }

  function toPercentage(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '0.00%';
    }
    return `${value.toFixed(2)}%`;
  }

  function toCountdown(nextRunValue) {
    if (!nextRunValue) {
      return '--';
    }

    const nextRunTime = new Date(nextRunValue).getTime();
    if (Number.isNaN(nextRunTime)) {
      return '--';
    }

    const remainingMs = Math.max(0, nextRunTime - Date.now());
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    }
    return `${seconds}s`;
  }

  function getTargetId(target) {
    if (target.type === 'website') {
      return `website:${target.url}`;
    }
    return `server:${target.host}:${target.port}`;
  }

  function getBadgeClass(status) {
    return status === 'UP' ? 'badge-up' : 'badge-down';
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return '';
    }

    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderTargetCard(target) {
    const targetId = getTargetId(target);
    const previousStatus = statusMap.get(targetId);
    const hasChanged = previousStatus && previousStatus !== target.status;
    statusMap.set(targetId, target.status);

    const endpointLabel =
      target.type === 'website' ? target.url : `${target.host}:${target.port}`;
    const statusDetails = [];

    if (target.statusCode) {
      statusDetails.push(`HTTP ${target.statusCode}`);
    }
    if (target.error) {
      statusDetails.push(target.error);
    }

    return `
      <article class="target-card ${target.status === 'UP' ? 'is-up' : 'is-down'} ${hasChanged ? 'status-changed' : ''
      }">
        <div class="target-card-header">
          <span class="status-badge ${getBadgeClass(target.status)}">${escapeHtml(target.status)}</span>
          <span class="response-time">${escapeHtml(toDuration(target.responseTime))}</span>
        </div>

        <h3>${escapeHtml(target.name)}</h3>
        <p class="endpoint">${escapeHtml(endpointLabel)}</p>

        <div class="target-stats">
          <span>Checks: ${escapeHtml(target.totalChecks || 0)}</span>
          <span>Uptime: ${escapeHtml(toPercentage(target.uptimePercentage || 0))}</span>
        </div>

        <div class="target-meta">
          <span>Last success: ${escapeHtml(toLocalDateTime(target.lastSuccessTime))}</span>
          <span>Last failure: ${escapeHtml(toLocalDateTime(target.lastFailureTime))}</span>
        </div>

        ${statusDetails.length > 0
        ? `<p class="target-error">${escapeHtml(statusDetails.join(' | '))}</p>`
        : ''
      }
      </article>
    `;
  }

  function renderGrid(targets, container) {
    if (!targets || targets.length === 0) {
      container.innerHTML = '<p class="grid-empty">No targets found.</p>';
      return;
    }

    container.innerHTML = targets.map((target) => renderTargetCard(target)).join('');
  }

  function renderSummary() {
    const summary = results.summary || {};
    totalTargetsValue.textContent = String(summary.totalTargets || 0);
    totalUpValue.textContent = String(summary.totalUp || 0);
    totalDownValue.textContent = String(summary.totalDown || 0);
    uptimePercentageValue.textContent = toPercentage(results.uptimePercentage || 0);
    completedCyclesValue.textContent = String(results.totalChecks || 0);
    cycleDurationValue.textContent = toDuration(results.checkDurationMs);
    lastUpdatedValue.textContent = toLocalDateTime(results.lastRun);
  }

  function renderSections() {
    const targets = Array.isArray(results.targets) ? results.targets : [];
    const websites = targets.filter((target) => target.type === 'website');
    const servers = targets.filter((target) => target.type === 'server');

    websitesCountBadge.textContent = `${websites.length} targets`;
    serversCountBadge.textContent = `${servers.length} targets`;

    renderGrid(websites, websitesGrid);
    renderGrid(servers, serversGrid);

    const shouldShowEmptyState = targets.length === 0;
    emptyState.classList.toggle('hidden', !shouldShowEmptyState);
  }

  function renderCountdown() {
    nextCheckCountdownValue.textContent = toCountdown(results.nextRun);
  }

  function syncCheckButtonState() {
    const isChecking = Boolean(results.isChecking) || isManualCheckPending;
    checkNowButton.disabled = isChecking;
    checkNowSpinner.classList.toggle('hidden', !isChecking);
    checkNowLabel.textContent = isChecking ? 'Checking...' : 'Check Now';
  }

  function renderDashboard() {
    renderSummary();
    renderSections();
    renderCountdown();
    syncCheckButtonState();
  }

  async function fetchStatus() {
    if (isStatusFetchPending) {
      return;
    }

    isStatusFetchPending = true;

    try {
      const response = await fetch(`/api/status?t=${Date.now()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Status fetch failed with code ${response.status}`);
      }

      const payload = await response.json();
      results = normalizeResults(payload);
      renderDashboard();
    } catch (error) {
      console.error('Status refresh failed.', error);
    } finally {
      isStatusFetchPending = false;
      syncCheckButtonState();
    }
  }

  async function runManualCheck() {
    if (isManualCheckPending || results.isChecking) {
      return;
    }

    isManualCheckPending = true;
    syncCheckButtonState();

    try {
      const response = await fetch('/api/check', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Manual check failed with code ${response.status}`);
      }

      const payload = await response.json();
      results = normalizeResults(payload);
      renderDashboard();
    } catch (error) {
      console.error('Manual check failed.', error);
    } finally {
      isManualCheckPending = false;
      syncCheckButtonState();
      void fetchStatus();
    }
  }

  checkNowButton.addEventListener('click', () => {
    void runManualCheck();
  });

  renderDashboard();

  setInterval(() => {
    renderCountdown();
  }, 1000);

  setInterval(() => {
    void fetchStatus();
  }, 15_000); // 15 seconds
})();
