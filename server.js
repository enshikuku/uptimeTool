const express = require('express');
const path = require('path');
const {
  CHECK_INTERVAL_MS,
  getResultsSnapshot,
  runChecks,
  startMonitoring,
} = require('./monitor');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.render('index', {
    results: getResultsSnapshot(),
    checkIntervalMs: CHECK_INTERVAL_MS,
  });
});

app.get('/api/status', (_req, res) => {
  res.json(getResultsSnapshot());
});

app.post('/api/check', async (_req, res, next) => {
  try {
    const updatedResults = await runChecks({ reason: 'manual' });
    res.json(updatedResults);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'api.request.failed',
      message: error.message,
    })
  );

  res.status(500).json({
    message: 'Unable to complete the request.',
  });
});

app.listen(PORT, () => {
  console.log(`Uptime Monitor running on http://localhost:${PORT}`);
  startMonitoring();
});
