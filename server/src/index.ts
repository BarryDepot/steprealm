// StepRealm API server — process entry point.

import 'dotenv/config';
import { createApp } from './app';
import { pool } from './db';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

const server = app.listen(port, () => {
  console.log(`StepRealm API listening on :${port}`);
});

// Hosting platforms send SIGTERM on redeploy. Finishing in-flight requests
// before closing the pool avoids a burst of errors on every deploy.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => { void pool.end().then(() => process.exit(0)); });
  });
}
