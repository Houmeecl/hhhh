import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, logActividad } from '../middleware/auth.js';
import { validarMensajeTorre } from '../services/pasaporteOrigen.js';

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
    const val = validarMensajeTorre(b);
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
              (SELECT json_agg(json_build_object('serial', t.serial, 'portador', t.portador))
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
    res.json({ flota: rows });
  } catch (err) { next(err); }
});
