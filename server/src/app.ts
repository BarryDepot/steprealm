// Express application.
//
// Kept separate from index.ts, which owns listening and shutdown. The split
// lets the integration tests mount this app on an ephemeral port without
// starting the real server or racing the port the developer is using.

import express from 'express';
import cors from 'cors';

import { router } from './routes/players';
import { errorHandler, notFound } from './middleware/errors';
import { pool } from './db';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '64kb' }));

  // Health check for the hosting platform. Also the quickest way to confirm
  // the database credentials are right after a deploy.
  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'up' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  app.use('/api', router);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
