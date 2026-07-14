import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { get, all, run, uuid, seedCodigos } from './lib/db.js';
import { enviarConfirmacionWaitlist } from './lib/mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '4200', 10);
const CUPOS = parseInt(process.env.CUPOS || '100', 10);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

seedCodigos(CUPOS);

const app = express();
app.use(express.json({ limit: '256kb' }));

// ---------- Lista de espera (empresas o personas) ----------
app.post('/api/waitlist', (req, res) => {
  const { empresa, contacto, email, rubro, tamano, origen } = req.body || {};
  if (!email || !EMAIL_RE.test(String(email))) {
    return res.status(400).json({ error: 'Ingresa un correo válido.' });
  }
  try {
    run(
      `INSERT INTO waitlist (id, empresa, contacto, email, rubro, tamano, origen, created_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET
         empresa=COALESCE(excluded.empresa, waitlist.empresa),
         contacto=COALESCE(excluded.contacto, waitlist.contacto),
         rubro=COALESCE(excluded.rubro, waitlist.rubro),
         tamano=COALESCE(excluded.tamano, waitlist.tamano)`,
      uuid(), empresa || null, contacto || null, String(email).toLowerCase().trim(),
      rubro || null, tamano || null, origen || null, Date.now()
    );
    res.status(201).json({ ok: true, mensaje: '¡Listo! Te avisaremos cuando abramos tu cupo.' });

    // Confirmación con el informe de muestra adjunto (no bloqueante: nunca afecta la respuesta).
    enviarConfirmacionWaitlist({ email: String(email).toLowerCase().trim(), empresa })
      .catch((e) => console.warn('[waitlist] no se pudo enviar el correo de confirmación:', e.message));
  } catch (e) {
    res.status(500).json({ error: 'No se pudo registrar. Intenta nuevamente.' });
  }
});

// ---------- Validar código de piloto (uso único) ----------
app.post('/api/piloto/validar', (req, res) => {
  const codigo = String((req.body?.codigo) || '').toUpperCase().trim();
  const empresa = req.body?.empresa || null;
  if (!codigo) return res.status(400).json({ error: 'Ingresa tu código de piloto.' });
  const row = get('SELECT * FROM codigos_piloto WHERE codigo = ?', codigo);
  if (!row) return res.status(404).json({ error: 'Código no válido.' });
  if (row.usado) return res.status(409).json({ error: 'Este código ya fue usado.' });
  run('UPDATE codigos_piloto SET usado = 1, empresa = ?, usado_at = ? WHERE codigo = ?', empresa, Date.now(), codigo);
  res.json({ ok: true, mensaje: '¡Bienvenida, empresa fundadora! Te contactaremos para activar tu piloto.' });
});

// ---------- Cupos restantes (contador del hero) ----------
app.get('/api/piloto/cupos', (req, res) => {
  const total = get('SELECT count(*) AS n FROM codigos_piloto').n;
  const usados = get('SELECT count(*) AS n FROM codigos_piloto WHERE usado = 1').n;
  res.json({ total, usados, restantes: total - usados });
});

// ---------- Estático (landing + SEO) ----------
app.use(express.static(path.resolve(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'No encontrado' });
  res.sendFile(path.resolve(__dirname, 'public/index.html'));
});

app.listen(PORT, () => {
  const { restantes } = { restantes: get('SELECT count(*) AS n FROM codigos_piloto WHERE usado = 0').n };
  console.log(`\n  Pre-lanzamiento en http://localhost:${PORT}`);
  console.log(`  Cupos de piloto disponibles: ${restantes}/${CUPOS}\n`);
});
