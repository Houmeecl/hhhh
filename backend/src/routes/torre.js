import express from 'express';
import crypto from 'crypto';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, logActividad } from '../middleware/auth.js';
import { validarMensajeTorre } from '../services/pasaporteOrigen.js';
import { fronterasCorredor } from '../services/catalogoCorredor.js';

// ============================================================
// Router de la TORRE DE CONTROL — montado en /api/torre. La torre se
// autentica con la credencial de un terminal (rol 'pos', el mismo login
// de dispositivo del mostrador vía POST /api/pos/auth) y envía
// instrucciones operativas al camión de un lote: dirigirse al puerto
// seco o al puerto. Los mensajes son APPEND-ONLY y NO entran en la
// cadena de hash del lote (son operación, no custodia — migración 024).
// Extraído de routes/origen.js (antes mezclado con el resto del dominio
// de lotes): no depende de nada propio de ese archivo.
// ============================================================
export const torreRouter = express.Router();

// POST /api/torre/mensaje — instrucción de la torre para un lote:
// puerto_seco | puerto | estacionamiento (con zona obligatoria).
torreRouter.post('/mensaje', requireAuth, requireRole('pos'), async (req, res, next) => {
  try {
    const b = req.body || {};
    // Fronteras desde la tabla puntos_corredor (093), con fallback estático.
    const val = validarMensajeTorre(b, await fronterasCorredor());
    if (!val.ok) return res.status(400).json({ error: val.error });

    const codigo = String(b.codigo_lote || '').trim().toUpperCase();
    const { rows: lRows } = await query(
      `SELECT id, codigo FROM lotes_minerales WHERE codigo = $1`, [codigo]
    );
    if (!lRows[0]) return res.status(404).json({ error: 'Lote no encontrado' });

    const { rows: tRows } = await query(
      `SELECT nombre FROM pos_terminales WHERE id = $1`, [req.user.sub]
    );
    const emisor = tRows[0]?.nombre || 'torre';

    const { rows } = await query(
      `INSERT INTO torre_mensajes (lote_id, destino, zona, nota, emisor)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, destino, zona, nota, emisor, creado`,
      [lRows[0].id, val.destino, val.zona, val.nota, emisor]
    );
    await logActividad({
      accion: 'torre_mensaje', entidad: 'torre_mensaje', entidadId: rows[0].id,
      detalle: { lote: lRows[0].codigo, destino: val.destino, zona: val.zona }, ip: req.ip,
    });
    res.status(201).json({ mensaje: rows[0] });
  } catch (err) { next(err); }
});

// GET /api/torre/flota — TODOS los camiones activos en un solo mapa.
// Solo para operadores autenticados (rol pos): la vista de flota lista
// la operación completa, no es para el público (el pasaporte de cada
// lote sigue siendo público por su propio código, como siempre).
// Un lote "aparece en el mapa" recién cuando tiene un paso con punto
// reconocible — un camión nuevo se ve al ACTIVARSE con su primer paso.
//
// Orden: el camión con el paso sellado MÁS ANTIGUO primero — es el que
// lleva más tiempo sin avanzar, el que más necesita atención del
// operador (ver lib/corredor.js estadoAvance en el frontend, que colorea
// esta lista con los umbrales de alerta). Los que aún no tienen ningún
// paso reconocible van al final (NULLS LAST): el frontend ya los separa
// en su propia sección "sin posición".
// GET /api/torre/kpis — agregados de la operación para el tablero de
// flota. Todo se calcula desde los eslabones REALES (append-only) contra
// el `orden` de la tabla puntos_corredor; si no hay datos suficientes se
// devuelve n=0 y el frontend dice "sin datos aún" — nunca un número
// inventado. Cache in-memory 60 s: son agregados lentos (pasos de camión
// distan horas), no posición en vivo.
//  - tramos: horas promedio entre pares CONSECUTIVOS del corredor
//    (orden destino = orden origen + 1, últimos 90 días). Saltos de
//    varios puntos y retrocesos NO cuentan como tramo.
//  - retrocesos_30d: pasos cuyo punto retrocede respecto del máximo
//    histórico de su lote (misma semántica que pasosRetrocedidos() del
//    frontend), contados en los últimos 30 días.
let kpisCache = { data: null, ts: 0 };
const KPIS_TTL_MS = 60 * 1000;

// Para los tests (los agregados cambian entre casos sin esperar el TTL).
export function invalidarCacheKpis() {
  kpisCache = { data: null, ts: 0 };
}

torreRouter.get('/kpis', requireAuth, requireRole('pos'), async (req, res, next) => {
  try {
    const ahora = Date.now();
    if (kpisCache.data && ahora - kpisCache.ts < KPIS_TTL_MS) {
      const etag = `"${crypto.createHash('sha1').update(JSON.stringify(kpisCache.data)).digest('hex')}"`;
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
      res.set('ETag', etag);
      return res.json(kpisCache.data);
    }
    // El JOIN va contra TODA la tabla (también puntos inactivos): los
    // pasos históricos en un punto desactivado siguen siendo medibles.
    const { rows: tramos } = await query(
      `WITH pasos AS (
         SELECT e.lote_id, e.eslabon, e.created_at, pc.orden, pc.id AS punto_id
           FROM lote_eslabones e
           JOIN puntos_corredor pc ON pc.id = e.datos->>'punto_id'
       ), con_prev AS (
         SELECT lote_id, created_at, orden, punto_id,
                LAG(orden)      OVER w AS orden_prev,
                LAG(punto_id)   OVER w AS punto_prev,
                LAG(created_at) OVER w AS creado_prev
           FROM pasos
         WINDOW w AS (PARTITION BY lote_id ORDER BY eslabon)
       )
       SELECT punto_prev AS desde, punto_id AS hasta, orden_prev AS orden,
              round(avg(EXTRACT(EPOCH FROM created_at - creado_prev)) / 3600, 1) AS horas_promedio,
              count(*)::int AS n
         FROM con_prev
        WHERE orden = orden_prev + 1
          AND created_at > creado_prev
          AND created_at > now() - interval '90 days'
        GROUP BY punto_prev, punto_id, orden_prev
        ORDER BY orden_prev`
    );
    const { rows: retro } = await query(
      `WITH pasos AS (
         SELECT e.lote_id, e.eslabon, e.created_at, pc.orden
           FROM lote_eslabones e
           JOIN puntos_corredor pc ON pc.id = e.datos->>'punto_id'
       ), con_max AS (
         SELECT lote_id, created_at, orden,
                MAX(orden) OVER (PARTITION BY lote_id ORDER BY eslabon
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS max_prev
           FROM pasos
       )
       SELECT count(*)::int AS n, count(DISTINCT lote_id)::int AS lotes
         FROM con_max
        WHERE max_prev IS NOT NULL AND orden < max_prev
          AND created_at > now() - interval '30 days'`
    );
    const data = {
      tramos: tramos.map((t) => ({
        desde: t.desde, hasta: t.hasta,
        horas_promedio: Number(t.horas_promedio), n: t.n,
      })),
      retrocesos_30d: { n: retro[0]?.n || 0, lotes: retro[0]?.lotes || 0 },
      generado: new Date().toISOString(),
    };
    kpisCache = { data, ts: ahora };
    const etag = `"${crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex')}"`;
    res.set('ETag', etag);
    res.json(data);
  } catch (err) { next(err); }
});

torreRouter.get('/flota', requireAuth, requireRole('pos'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT l.codigo, l.tipo, l.material, l.estado, l.n_eslabones, l.updated_at,
              (SELECT json_build_object(
                 'punto_id', e.datos->>'punto_id',
                 'punto_control', e.datos->>'punto_control',
                 'fecha', e.fecha, 'pais', e.pais, 'creado', e.created_at)
               FROM lote_eslabones e
               WHERE e.lote_id = l.id
                 AND (e.datos ? 'punto_id' OR e.datos ? 'punto_control')
               ORDER BY e.eslabon DESC LIMIT 1) AS ultimo_paso,
              (SELECT json_build_object(
                 'destino', m.destino, 'zona', m.zona, 'nota', m.nota, 'creado', m.creado)
               FROM torre_mensajes m
               WHERE m.lote_id = l.id ORDER BY m.creado DESC LIMIT 1) AS instruccion,
              -- ORDER BY: con 2+ tarjetas activas por lote, un json_agg sin
              -- orden puede serializar distinto entre requests con el mismo
              -- dato → ETag espurio → el polling nunca ve un 304 real.
              (SELECT json_agg(json_build_object('serial', t.serial, 'portador', t.portador) ORDER BY t.serial)
               FROM tarjetas_viaje t
               WHERE t.lote_id = l.id AND t.activo) AS tarjetas
       FROM lotes_minerales l
       WHERE l.estado = 'abierto'
         AND EXISTS (SELECT 1 FROM tarjetas_viaje t WHERE t.lote_id = l.id AND t.activo)
       ORDER BY (SELECT e.created_at FROM lote_eslabones e
                  WHERE e.lote_id = l.id
                    AND (e.datos ? 'punto_id' OR e.datos ? 'punto_control')
                  ORDER BY e.eslabon DESC LIMIT 1) ASC NULLS LAST
       LIMIT 100`
    );
    const data = { flota: rows };
    const etag = `"${crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.set('ETag', etag);
    res.json(data);
  } catch (err) { next(err); }
});
