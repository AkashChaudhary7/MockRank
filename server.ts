import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { apiRouter } from './server/apiRouter.js';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  // Explicitly block any public access to private answer keys
  app.use('/server', (_req, res) => {
    res.status(403).json({ error: 'Access to private server resources is forbidden.' });
  });
  app.use('/private-question-keys', (_req, res) => {
    res.status(403).json({ error: 'Access to private answer keys is forbidden.' });
  });

  // Mount server-authoritative API routes
  app.use('/api', apiRouter);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(
      '/question-bank',
      express.static(path.join(distPath, 'question-bank'), {
        maxAge: '1h',
        etag: true,
      })
    );
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MockRank Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
