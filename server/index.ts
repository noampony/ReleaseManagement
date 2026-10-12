import express from 'express';
import { errorHandler } from './http/errors.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json({ limit: '1mb', strict: true }));

app.get('/api/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

app.use(errorHandler);

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
