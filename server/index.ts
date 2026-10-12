import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.get('/api/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
