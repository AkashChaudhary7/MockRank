import express from 'express';
import { apiRouter } from '../server/apiRouter.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter);

export default app;
