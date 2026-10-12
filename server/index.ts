import express from 'express';
import { assertAuthConfiguration, createDevLoginHandler, requireUser } from './auth/index.js';
import { errorHandler } from './http/errors.js';
import { deploymentsRouter } from './routes/deployments.js';
import { releaseManagementRouter } from './routes/release-management.js';

assertAuthConfiguration();

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json({ limit: '1mb', strict: true }));

app.get('/api/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

const devLoginHandler = createDevLoginHandler();
if (devLoginHandler) app.post('/api/dev/login', devLoginHandler);

app.get('/api/auth/me', requireUser, (_request, response) => {
  response.status(200).json(response.locals.user);
});

app.use('/api/deployments', deploymentsRouter);
app.use('/api', releaseManagementRouter);

app.use(errorHandler);

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
