const net = require('net');

const CHECK_INTERVAL_MS = 15_000;
const HTTP_TIMEOUT_MS = 9_000;
const TCP_TIMEOUT_MS = 5_000;

const websiteTargets = [
  { name: 'AIMHub Lighthouses', url: 'https://aimhublighthouses.uoeld.ac.ke' },
  { name: 'AIMHub API', url: 'https://aimhub-api.duckdns.org/' },
  { name: 'Flycation KE', url: 'https://flycationke.duckdns.org/' },
  { name: 'Flycation KE API', url: 'https://flycationke-api.duckdns.org/' },
  { name: 'Pathle Consultants', url: 'https://pathleconsultants.duckdns.org/' },
  { name: 'Bikexify App', url: 'https://app.bikexify.co.ke' },
  { name: 'Bikexify API', url: 'https://api.bikexify.co.ke' },
  { name: 'Bikexify', url: 'https://bikexify.co.ke' },
];

const serverTargets = [
  { name: 'Server 193.181.211.219', host: '193.181.211.219', port: 22 },
  { name: 'Server 41.89.169.160', host: '41.89.169.160', port: 9160 },
];

const targetStats = new Map();

const results = {
  isChecking: false,
  lastRun: null,
  nextRun: null,
  totalChecks: 0,
  uptimePercentage: null,
  lastSuccessTime: null,
  lastFailureTime: null,
  checkDurationMs: null,
  summary: {
    totalTargets: websiteTargets.length + serverTargets.length,
    totalUp: 0,
    totalDown: 0,
  },
  targets: [],
};

let isChecking = false;
let activeRunPromise = null;
let scheduleHandle = null;

function log(level, event, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  };

  const line = JSON.stringify(payload);
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.info(line);
}

function getTargetKey(target) {
  if (target.type === 'website') {
    return `website:${target.url}`;
  }
  return `server:${target.host}:${target.port}`;
}

function withTargetMetadata(targetResult) {
  const key = getTargetKey(targetResult);
  const existingStats = targetStats.get(key) || {
    totalChecks: 0,
    successfulChecks: 0,
    failedChecks: 0,
    lastSuccessTime: null,
    lastFailureTime: null,
  };

  existingStats.totalChecks += 1;
  if (targetResult.status === 'UP') {
    existingStats.successfulChecks += 1;
    existingStats.lastSuccessTime = targetResult.lastChecked;
  } else {
    existingStats.failedChecks += 1;
    existingStats.lastFailureTime = targetResult.lastChecked;
  }

  const uptimePercentage =
    existingStats.totalChecks === 0
      ? 0
      : Number(((existingStats.successfulChecks / existingStats.totalChecks) * 100).toFixed(2));

  const nextStats = {
    ...existingStats,
    uptimePercentage,
  };

  targetStats.set(key, nextStats);

  return {
    ...targetResult,
    totalChecks: nextStats.totalChecks,
    uptimePercentage: nextStats.uptimePercentage,
    lastSuccessTime: nextStats.lastSuccessTime,
    lastFailureTime: nextStats.lastFailureTime,
    checkDurationMs: targetResult.responseTime,
  };
}

function updateResultsStore(targetResults, cycleStartedAt, cycleFinishedAt) {
  const totalTargets = targetResults.length;
  const totalUp = targetResults.filter((target) => target.status === 'UP').length;
  const totalDown = totalTargets - totalUp;

  results.targets = targetResults;
  results.lastRun = cycleFinishedAt.toISOString();
  results.nextRun = new Date(cycleFinishedAt.getTime() + CHECK_INTERVAL_MS).toISOString();
  results.totalChecks += 1;
  results.checkDurationMs = cycleFinishedAt.getTime() - cycleStartedAt.getTime();
  results.uptimePercentage =
    totalTargets === 0 ? 0 : Number(((totalUp / totalTargets) * 100).toFixed(2));
  results.summary = {
    totalTargets,
    totalUp,
    totalDown,
  };

  if (totalUp > 0) {
    results.lastSuccessTime = results.lastRun;
  }
  if (totalDown > 0) {
    results.lastFailureTime = results.lastRun;
  }
}

async function checkWebsite(target) {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });

    return {
      type: 'website',
      name: target.name,
      url: target.url,
      status: response.status < 500 ? 'UP' : 'DOWN',
      statusCode: response.status,
      responseTime: Date.now() - start,
      lastChecked: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      type: 'website',
      name: target.name,
      url: target.url,
      status: 'DOWN',
      statusCode: null,
      responseTime: Date.now() - start,
      lastChecked: new Date().toISOString(),
      error: error.name === 'AbortError' ? 'Timeout' : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function checkServer(target) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finalize = (status, errorMessage = null) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve({
        type: 'server',
        name: target.name,
        host: target.host,
        port: target.port,
        status,
        responseTime: Date.now() - start,
        lastChecked: new Date().toISOString(),
        error: errorMessage,
      });
    };

    socket.setTimeout(TCP_TIMEOUT_MS);
    socket.once('connect', () => finalize('UP'));
    socket.once('timeout', () => finalize('DOWN', 'Timeout'));
    socket.once('error', (error) => finalize('DOWN', error.message));
    socket.connect(target.port, target.host);
  });
}

async function runChecksParallel() {
  const websiteChecks = websiteTargets.map((target) => checkWebsite(target));
  const serverChecks = serverTargets.map((target) => checkServer(target));
  const rawResults = await Promise.all([...websiteChecks, ...serverChecks]);
  return rawResults.map((targetResult) => withTargetMetadata(targetResult));
}

function getResultsSnapshot() {
  return {
    ...results,
    summary: { ...results.summary },
    targets: results.targets.map((target) => ({ ...target })),
  };
}

function formatFailureForLog(target) {
  const location =
    target.type === 'website' ? target.url : `${target.host}:${target.port}`;
  const reason = target.error || (target.statusCode ? `HTTP ${target.statusCode}` : 'Unknown error');

  return {
    name: target.name,
    type: target.type,
    location,
    reason,
    responseTime: target.responseTime,
  };
}

async function runChecks(options = {}) {
  const reason = options.reason || 'manual';

  if (isChecking && activeRunPromise) {
    await activeRunPromise;
    return getResultsSnapshot();
  }

  isChecking = true;
  results.isChecking = true;

  activeRunPromise = (async () => {
    const cycleStartedAt = new Date();
    const targetCount = websiteTargets.length + serverTargets.length;

    log('info', 'uptime.check.started', {
      reason,
      targetCount,
    });

    try {
      const targetResults = await runChecksParallel();
      const cycleFinishedAt = new Date();
      updateResultsStore(targetResults, cycleStartedAt, cycleFinishedAt);

      log('info', 'uptime.check.completed', {
        reason,
        durationMs: results.checkDurationMs,
        totalTargets: results.summary.totalTargets,
        totalUp: results.summary.totalUp,
        totalDown: results.summary.totalDown,
      });

      const failedTargets = targetResults.filter((target) => target.status === 'DOWN');
      if (failedTargets.length > 0) {
        log('warn', 'uptime.check.failures', {
          reason,
          count: failedTargets.length,
          failures: failedTargets.map((target) => formatFailureForLog(target)),
        });
      }
    } catch (error) {
      log('error', 'uptime.check.error', {
        reason,
        message: error.message,
      });
    }
  })();

  try {
    await activeRunPromise;
  } finally {
    isChecking = false;
    results.isChecking = false;
    activeRunPromise = null;
  }

  return getResultsSnapshot();
}

function startMonitoring() {
  if (scheduleHandle) {
    return;
  }

  void runChecks({ reason: 'startup' });
  scheduleHandle = setInterval(() => {
    void runChecks({ reason: 'scheduled' });
  }, CHECK_INTERVAL_MS);
}

function stopMonitoring() {
  if (!scheduleHandle) {
    return;
  }

  clearInterval(scheduleHandle);
  scheduleHandle = null;
}

module.exports = {
  CHECK_INTERVAL_MS,
  getResultsSnapshot,
  runChecks,
  startMonitoring,
  stopMonitoring,
};
