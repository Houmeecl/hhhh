import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { hashApiKey } from '../services/mandante.js';
import { logActividad } from '../middleware/auth.js';
import { bigquery } from '../services/bigquery.js';
import {
  filtrarPorVisibilidad, semaforoDocumental, resumenNormativo, balanceMasas, emisionesIncorporadasPorTonelada,
} from '../services/pasaporteOrigen.js';
import { verificarCadenaCompleta } from '../services/cadenaHash.js';
import { generateExpedienteLote } from '../services/pdf.js';
import { subirDocumentoLote, uploadDocumentoLote } from './origen.js';

// ============================================================
// API para AGENCIAS DE ADUANA — dos caminos de acceso a los MISMOS datos:
//  1) X-Api-Key (migración 046): integración de sistemas externos.
//  2) Sesión (Bearer JWT, panel='agencia'): el operador humano de la
//     agencia entra por /panel-agencia/login con su propia cuenta
//     (email+contraseña), atada a esta MISMA fila de `agencias_aduana`
//     vía usuarios.agencia_id — nunca ve datos de otra agencia.
// A diferencia de puerto.js (solo lectura), este panel SÍ escribe: sube
// documentos del expediente (pantalla de captura tablet/PC, sin marca
// POS ni cobro) — es quien captura el expediente en terreno. La agencia
// sigue realizando la tramitación oficial; sicr3p es su infraestructura
// documental/de trazabilidad — nunca se presenta como agencia de aduanas.
// ============================================================

const router = express.Router();

async function requireAgencia(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      let payload;
      try {
        payload = jwt.verify(authHeader.slice(7), config.jwt.accessSecret);
      } catch {
        return res.status(401).json({ error: 'Sesión expirada o inválida.' });
      }
      if (payload.panel !== 'agencia' || !payload.agencia_id) {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso al panel de agencia.' });
      }
      const { rows } = await query(`SELECT * FROM agencias_aduana WHERE id = $1`, [payload.agencia_id]);
      const a = rows[0];
      if (!a || !a.activo) return res.status(401).json({ error: 'Agencia inactiva.' });
      req.agencia = a;
      req.usuarioId = payload.sub;
      req.nivelAcceso = payload.nivel_acceso || 'operador';
      return next();
    }
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'Falta el header X-Api-Key o una sesión.' });
    const { rows } = await query(`SELECT * FROM agencias_aduana WHERE token_hash = $1`, [hashApiKey(key)]);
    const a = rows[0];
    if (!a || !a.activo) return res.status(401).json({ error: 'API key inválida o inactiva.' });
    await query(`UPDATE agencias_aduana SET ultimo_uso = now() WHERE id = $1`, [a.id]);
    req.agencia = a;
    req.usuarioId = null;
    req.nivelAcceso = 'operador'; // integración por API key: siempre acceso completo
    next();
  } catch (err) { next(err); }
}
router.use(requireAgencia);

// Exige nivel_acceso='operador' — mismo criterio que requireNivelOperador
// (middleware/auth.js), aplicado sobre req.nivelAcceso porque este router
// no usa requireAuth (jwt.verify manual, ver requireAgencia arriba).
function requireNivelOperadorAgencia(req, res, next) {
  if (req.nivelAcceso === 'lectura') {
    return res.status(403).json({ error: 'Tu cuenta es de solo lectura.' });
  }
  next();
}

// ---------- GET /api/agencia/expedientes — lotes documentales de MI agencia ----------
router.get('/expedientes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, codigo, tipo, material, estado, n_eslabones, doc_n_documentos, updated_at, created_at
       FROM lotes_minerales
       WHERE tipo = 'documental' AND agencia_id = $1
       ORDER BY updated_at DESC LIMIT 200`,
      [req.agencia.id]
    );
    res.json({ agencia: { nombre: req.agencia.nombre }, expedientes: rows });

    const detalle = { agencia_id: req.agencia.id, n_expedientes: rows.length };
    logActividad({ usuarioId: req.usuarioId, accion: 'consulta_expedientes_agencia', entidad: 'agencia_aduana', entidadId: req.agencia.id, detalle, ip: req.ip });
    bigquery.exportAcceso({ tipo: 'consulta_expedientes_agencia', actor: { tipo: 'agencia', id: req.agencia.id }, detalle });
  } catch (err) { next(err); }
});

// Carga el expediente y confirma que pertenece a MI agencia — helper
// compartido por el detalle, el PDF y la subida de documentos.
async function miExpediente(req) {
  const { rows } = await query(
    `SELECT * FROM lotes_minerales WHERE codigo = $1 AND tipo = 'documental' AND agencia_id = $2`,
    [req.params.codigo, req.agencia.id]
  );
  return rows[0] || null;
}

// ---------- GET /api/agencia/expedientes/:codigo — detalle completo ----------
router.get('/expedientes/:codigo', async (req, res, next) => {
  try {
    const lote = await miExpediente(req);
    if (!lote) return res.status(404).json({ error: 'Expediente no encontrado.' });

    const [{ rows: eslabones }, { rows: documentos }] = await Promise.all([
      query(`SELECT * FROM lote_eslabones WHERE lote_id = $1 ORDER BY eslabon`, [lote.id]),
      query(
        `SELECT id, lote_id, eslabon_id, tipo_documento, archivo_original, extension, tamano_bytes,
                sha256, estado, etapa_lectura, visibilidad, hash_documento, hash_anterior, hash_cadena,
                revisado_por, revisado_en, created_at
         FROM lote_documentos WHERE lote_id = $1 ORDER BY created_at DESC`,
        [lote.id]
      ),
    ]);

    res.json({
      lote,
      eslabones: filtrarPorVisibilidad(eslabones, 'cadena'),
      documentos,
      semaforo: semaforoDocumental(lote, documentos),
      integridad: verificarCadenaCompleta(eslabones),
    });

    const detalle = { agencia_id: req.agencia.id, codigo: lote.codigo };
    logActividad({ usuarioId: req.usuarioId, accion: 'consulta_expediente_agencia', entidad: 'agencia_aduana', entidadId: req.agencia.id, detalle, ip: req.ip });
    bigquery.exportAcceso({ tipo: 'consulta_expediente_agencia', actor: { tipo: 'agencia', id: req.agencia.id }, detalle });
  } catch (err) { next(err); }
});

// ---------- GET /api/agencia/expedientes/:codigo/expediente.pdf ----------
router.get('/expedientes/:codigo/expediente.pdf', async (req, res, next) => {
  try {
    const lote = await miExpediente(req);
    if (!lote) return res.status(404).json({ error: 'Expediente no encontrado.' });
    const [{ rows: eslabones }, { rows: declaraciones }, { rows: documentos }, { rows: tarjetas }] = await Promise.all([
      query(`SELECT * FROM lote_eslabones WHERE lote_id = $1 ORDER BY eslabon`, [lote.id]),
      query(`SELECT codigo, estado FROM lote_declaraciones WHERE lote_id = $1`, [lote.id]),
      query(`SELECT * FROM lote_documentos WHERE lote_id = $1 ORDER BY created_at`, [lote.id]),
      query(`SELECT serial, portador, placa_tracto, placa_semirremolque, conductor_nombre, conductor_documento FROM tarjetas_viaje WHERE lote_id = $1 ORDER BY created_at`, [lote.id]),
    ]);
    const pdf = await generateExpedienteLote({
      lote,
      eslabones: filtrarPorVisibilidad(eslabones, 'cadena'),
      declaraciones,
      normativo: resumenNormativo(lote, declaraciones),
      balance: balanceMasas(lote, eslabones),
      emisiones: emisionesIncorporadasPorTonelada(lote, eslabones),
      tarjetas,
      integra: verificarCadenaCompleta(eslabones).valido,
      documentos,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-expediente-${lote.codigo}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// ---------- POST /api/agencia/expedientes/:codigo/documentos ----------
// Pantalla de captura tablet/PC: la agencia sube factura, packing list,
// carta de porte, MIC/DTA, etc. del expediente que le corresponde. Reusa
// EXACTAMENTE la misma lógica de lectura/hash que el admin (routes/origen.js)
// — nunca una copia paralela.
router.post('/expedientes/:codigo/documentos', requireNivelOperadorAgencia, uploadDocumentoLote.single('archivo'), async (req, res, next) => {
  try {
    const lote = await miExpediente(req);
    if (!lote) return res.status(404).json({ error: 'Expediente no encontrado.' });

    const resultado = await subirDocumentoLote({
      loteId: lote.id, file: req.file,
      tipoDocumento: String(req.body?.tipo_documento || ''), subidoPor: req.usuarioId,
    });
    if (resultado.status === 201) {
      const detalle = { agencia_id: req.agencia.id, codigo: lote.codigo, tipo_documento: resultado.body.documento.tipo_documento, estado: resultado.body.documento.estado };
      logActividad({ usuarioId: req.usuarioId, accion: 'subir_documento_agencia', entidad: 'lote_documento', entidadId: resultado.body.documento.id, detalle, ip: req.ip });
      bigquery.exportAcceso({ tipo: 'subir_documento_agencia', actor: { tipo: 'agencia', id: req.agencia.id }, detalle });
    }
    res.status(resultado.status).json(resultado.body);
  } catch (err) { next(err); }
});

export default router;
