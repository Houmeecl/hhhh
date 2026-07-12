import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { db, get, all, run, dueno } from './lib/db.js';
import { hashClave, verifyClave, encrypt, randomId, randomSecret } from './lib/crypto.js';
import { validarRut, formatearRut, limpiarRut } from './lib/rut.js';
import { analizar } from './lib/engine.js';
import { generateReport, generateLabel } from './lib/pdf.js';
import { qrBuffer } from './lib/qr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '4100', 10);
const BASE_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const MAX_FILES = 5;

// Secreto JWT del dispositivo: generado una vez y guardado junto a los datos (gitignored).
const secretPath = path.resolve(__dirname, 'data', '.session-secret');
fs.mkdirSync(path.dirname(secretPath), { recursive: true });
let JWT_SECRET;
try { JWT_SECRET = fs.readFileSync(secretPath, 'utf8'); }
catch { JWT_SECRET = randomSecret(); fs.writeFileSync(secretPath, JWT_SECRET, { mode: 0o600 }); }

const app = express();
app.use(express.json({ limit: '1mb' }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: MAX_FILES },
  fileFilter: (req, f, cb) => cb(null, /\.(pdf|xml|jpe?g|png)$/i.test(f.originalname)),
});

const now = () => Date.now();
const round4 = (n) => Math.round(n * 10000) / 10000;

// ---------- Auth: exige sesión desbloqueada del dueño ----------
function requireUnlock(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Dispositivo bloqueado' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    const d = dueno();
    if (!d || d.rut !== p.rut) return res.status(401).json({ error: 'Sesión inválida' });
    req.rut = p.rut;
    req.nombre = d.dispositivo;
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión expirada. Vuelve a desbloquear.' });
  }
}

// ---------- Estado del dispositivo ----------
app.get('/api/status', (req, res) => {
  const d = dueno();
  res.json({
    enrolled: !!d,
    dispositivo: d ? d.dispositivo : null,
    rut: d ? d.rut : null,
  });
});

// ---------- Enrolamiento (primer uso): fija el dueño ----------
app.post('/api/enroll', (req, res) => {
  if (dueno()) return res.status(409).json({ error: 'Este dispositivo ya tiene un dueño.' });
  const { rut, clave, dispositivo } = req.body || {};
  if (!rut || !clave) return res.status(400).json({ error: 'RUT y clave SII son obligatorios.' });
  if (!validarRut(rut)) return res.status(400).json({ error: 'RUT inválido (dígito verificador).' });
  if (String(clave).length < 4) return res.status(400).json({ error: 'La clave debe tener al menos 4 caracteres.' });

  const rutFmt = formatearRut(rut);
  run(
    `INSERT INTO dispositivo (id, rut, dispositivo, clave_hash, clave_enc, created_at)
     VALUES (?,?,?,?,?,?)`,
    randomId(), rutFmt, dispositivo || 'Mi dispositivo sicr3p',
    hashClave(clave),           // verificador (no reversible)
    encrypt(clave, clave),      // clave SII "bajo código" (cifrada en reposo)
    now()
  );
  res.status(201).json({ ok: true, rut: rutFmt });
});

// ---------- Login / desbloqueo ----------
app.post('/api/login', (req, res) => {
  const d = dueno();
  if (!d) return res.status(400).json({ error: 'El dispositivo no está enrolado.' });
  const { rut, clave } = req.body || {};

  if (d.bloqueado_hasta && d.bloqueado_hasta > now()) {
    const seg = Math.ceil((d.bloqueado_hasta - now()) / 1000);
    return res.status(429).json({ error: `Demasiados intentos. Espera ${seg}s.` });
  }
  const rutOk = limpiarRut(rut) === limpiarRut(d.rut);
  const claveOk = verifyClave(clave || '', d.clave_hash);
  if (!rutOk || !claveOk) {
    const intentos = (d.intentos || 0) + 1;
    const bloqueo = intentos >= 5 ? now() + 60 * 1000 : null; // 1 min tras 5 fallos
    run(`UPDATE dispositivo SET intentos = ?, bloqueado_hasta = ? WHERE id = ?`, intentos, bloqueo, d.id);
    return res.status(401).json({ error: 'RUT o clave SII incorrectos.' });
  }
  run(`UPDATE dispositivo SET intentos = 0, bloqueado_hasta = NULL, ultimo_login = ? WHERE id = ?`, now(), d.id);
  const token = jwt.sign({ rut: d.rut }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token, dispositivo: d.dispositivo, rut: d.rut });
});

// ---------- Procesar facturas (solo el dueño) ----------
app.post('/api/sesiones', requireUnlock, upload.array('archivos', MAX_FILES), (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'Sube al menos una factura.' });
  if (files.length > MAX_FILES) return res.status(400).json({ error: 'Máximo 5 facturas por sesión.' });

  const sesionId = randomId();
  const fecha = new Date().toISOString().slice(0, 10);
  let total = 0;
  const dispRut = req.rut; // las facturas quedan bajo el RUT del dueño (aislamiento)

  run(`INSERT INTO sesiones (id, rut_cliente, nombre_cliente, email_cliente, fecha, total_co2e, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    sesionId, dispRut, req.nombre, null, fecha, 0, now());

  files.forEach((file, i) => {
    const a = analizar({ filename: file.originalname, index: i, rutReceptor: dispRut });
    total += Number(a.total_co2e || 0);
    const fid = randomId();
    run(`INSERT INTO facturas (id, sesion_id, numero_venta, archivo_original, rut_emisor, rut_receptor, total_co2e, categoria, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      fid, sesionId, a.numero_venta, file.originalname, a.rut_emisor, a.rut_receptor, a.total_co2e, a.categoria, now());
    for (const it of a.items) {
      run(`INSERT INTO line_items (id, factura_id, descripcion, cantidad, co2e, porcentaje_total)
           VALUES (?,?,?,?,?,?)`,
        randomId(), fid, it.descripcion, it.cantidad, it.co2e, it.porcentaje_total);
    }
  });
  run(`UPDATE sesiones SET total_co2e = ? WHERE id = ?`, round4(total), sesionId);
  res.status(201).json(hydrate(sesionId));
});

function hydrate(sesionId) {
  const sesion = get(`SELECT * FROM sesiones WHERE id = ?`, sesionId);
  if (!sesion) return null;
  const facturas = all(`SELECT * FROM facturas WHERE sesion_id = ? ORDER BY created_at`, sesionId);
  for (const f of facturas) f.items = all(`SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = ?`, f.id);
  return { sesion, facturas };
}

app.get('/api/sesiones/:id', requireUnlock, (req, res) => {
  const data = hydrate(req.params.id);
  if (!data) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json(data);
});

// Historial de sesiones del dueño.
app.get('/api/mis-sesiones', requireUnlock, (req, res) => {
  const rows = all(`SELECT s.*, (SELECT count(*) FROM facturas f WHERE f.sesion_id = s.id) AS n_facturas
                    FROM sesiones s ORDER BY s.created_at DESC LIMIT 100`);
  res.json({ sesiones: rows });
});

app.get('/api/sesiones/:id/informe.pdf', requireUnlock, async (req, res, next) => {
  try {
    const data = hydrate(req.params.id);
    if (!data) return res.status(404).json({ error: 'No encontrada' });
    const pdf = await generateReport(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-informe-${req.params.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (e) { next(e); }
});

app.get('/api/facturas/:id/etiqueta.pdf', requireUnlock, async (req, res, next) => {
  try {
    const factura = get(`SELECT * FROM facturas WHERE id = ?`, req.params.id);
    if (!factura) return res.status(404).json({ error: 'No encontrada' });
    factura.items = all(`SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = ?`, factura.id);
    const sesion = get(`SELECT * FROM sesiones WHERE id = ?`, factura.sesion_id);
    const pdf = await generateLabel({ sesion, factura, baseUrl: BASE_URL });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-etiqueta-${factura.numero_venta || factura.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (e) { next(e); }
});

app.get('/api/facturas/:id/qr.png', requireUnlock, async (req, res, next) => {
  try {
    const png = await qrBuffer(BASE_URL, req.params.id);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (e) { next(e); }
});

// Verificación (dentro del dispositivo). El QR apunta aquí.
app.get('/api/verificar/:id', (req, res) => {
  const factura = get(`SELECT * FROM facturas WHERE id = ?`, req.params.id);
  if (!factura) return res.status(404).json({ error: 'Documento no encontrado' });
  const items = all(`SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = ?`, factura.id);
  const sesion = get(`SELECT nombre_cliente, rut_cliente, fecha FROM sesiones WHERE id = ?`, factura.sesion_id);
  res.json({
    valido: true,
    factura: { id: factura.id, numero_venta: factura.numero_venta, categoria: factura.categoria, total_co2e: factura.total_co2e, fecha: sesion?.fecha },
    cliente: { nombre: sesion?.nombre_cliente, rut: sesion?.rut_cliente },
    items,
  });
});

// ---------- SPA estática ----------
app.use(express.static(path.resolve(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'No encontrado' });
  res.sendFile(path.resolve(__dirname, 'public/index.html'));
});

app.use((err, req, res, next) => {
  console.error('[portable]', err.message);
  res.status(500).json({ error: 'Error interno del dispositivo' });
});

app.listen(PORT, () => {
  const d = dueno();
  console.log(`\n  sicr3p portátil en ${BASE_URL}`);
  console.log(`  Estado: ${d ? `enrolado (${d.rut})` : 'sin dueño — se pedirá enrolar en el primer uso'}`);
  console.log(`  Datos locales: portable/data/sicr3p.db (aislado en este dispositivo)\n`);
});
