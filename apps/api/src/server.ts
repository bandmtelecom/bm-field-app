import express from 'express';
import cors from 'cors';
import { invoices } from './routes/invoices.js';
import { kml } from './routes/kml.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const origins = (process.env.CORS_ORIGINS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'bm-field-api' }));

app.use(invoices);
app.use(kml);

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`bm-field-api listening on :${port}`);
});
