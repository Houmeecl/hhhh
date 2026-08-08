import express from 'express';
import { query, withTx } from '../lib/db.js';
import { requireAuth, requireRole, logActividad } from '../middleware/auth.js';
import {
  nivelDePuntos, calcularPuntosTrayecto, esModoBajoCarbono,
  generarSerialCanje, hashCanje, otorgarPuntos, evaluarMisionesContador,
  impactoDeJugador,
} from '../services/juego.js';
import { bigquery } from '../services/bigquery.js';

// ============================================================
// "Sube y Suma" — /api/juego, rol 'jugador' (magic link con código de
// campaña de una empresa cliente, ver auth.js). El jugador queda ligado a
// un codigo_id: ranking y misiones nunca cruzan de una empresa a otra.
// ============================================================

const router = express.Router();
router.use(requireAuth, requireRole('jugador'));

async function jugadorDe(req) {
  const { rows } = await query(`SELECT * FROM jugadores WHERE id = $1`, [req.user.jugadorId]);
  return rows[0] || null;
}

function enmascararEmail(email) {
  const [usuario, dominio] = String(email || '').split('@');
  if (!usuario || !dominio) return 'Jugador';
  const visible = usuario.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, usuario.length - 2))}@${dominio}`;
}

// ---------- GET /perfil ----------
router.get('/perfil', async (req, res, next) => {
  try {
    const jugador = await jugadorDe(req);
    if (!jugador) return res.status(404).json({ error: 'Jugador no encontrado' });
    const nivel = nivelDePuntos(jugador.puntos_totales);
    const { rows: misiones } = await query(
      `SELECT m.codigo, m.nombre, m.descripcion, m.tipo, m.meta_valor, m.puntos_recompensa,
              COALESCE(mp.progreso, 0) AS progreso, mp.completada_at
       FROM misiones m
       LEFT JOIN misiones_progreso mp ON mp.mision_id = m.id AND mp.jugador_id = $1
       WHERE m.activo = true ORDER BY m.meta_valor`,
      [jugador.id]
    );
    // El código de campaña (no el id) — el frontend lo reenvía en cada
    // escaneo para consumir créditos, igual que un código normal (ver
    // POST /api/sesiones en public.js).
    const { rows: codRows } = await query(`SELECT codigo FROM codigos_acceso WHERE id = $1`, [jugador.codigo_id]);
    res.json({
      jugador: {
        email: jugador.email, nombre: jugador.nombre, empresa: jugador.empresa,
        puntos_totales: jugador.puntos_totales, codigo: codRows[0]?.codigo || null,
      },
      nivel,
      misiones,
    });
  } catch (err) { next(err); }
});

// ---------- GET /impacto — CO2e real detrás de los puntos del jugador ----------
router.get('/impacto', async (req, res, next) => {
  try {
    const jugador = await jugadorDe(req);
    if (!jugador) return res.status(404).json({ error: 'Jugador no encontrado' });
    const impacto = await impactoDeJugador(jugador.id);
    res.json(impacto);
  } catch (err) { next(err); }
});

// ---------- GET /ranking — top de la MISMA empresa, nunca cruza códigos ----------
router.get('/ranking', async (req, res, next) => {
  try {
    const jugador = await jugadorDe(req);
    if (!jugador) return res.status(404).json({ error: 'Jugador no encontrado' });
    const { rows } = await query(
      `SELECT id, nombre, email, puntos_totales,
              row_number() OVER (ORDER BY puntos_totales DESC, created_at ASC) AS posicion
       FROM jugadores WHERE codigo_id = $1
       ORDER BY puntos_totales DESC, created_at ASC LIMIT 20`,
      [jugador.codigo_id]
    );
    const ranking = rows.map((r) => ({
      posicion: Number(r.posicion),
      nombre: r.nombre || enmascararEmail(r.email),
      puntos_totales: r.puntos_totales,
      tu: r.id === jugador.id,
    }));
    res.json({ ranking });
  } catch (err) { next(err); }
});

// ---------- GET /recompensas ----------
router.get('/recompensas', async (req, res, next) => {
  try {
    const jugador = await jugadorDe(req);
    const { rows } = await query(
      `SELECT id, codigo, nombre, descripcion, costo_puntos, tipo FROM recompensas
       WHERE activo = true ORDER BY costo_puntos`
    );
    res.json({ recompensas: rows, puntos_totales: jugador?.puntos_totales ?? 0 });
  } catch (err) { next(err); }
});

// ---------- POST /recompensas/:id/canjear ----------
router.post('/recompensas/:id/canjear', async (req, res, next) => {
  try {
    const canje = await withTx(async (client) => {
      const { rows: jRows } = await client.query(
        `SELECT * FROM jugadores WHERE id = $1 FOR UPDATE`, [req.user.jugadorId]
      );
      const jugador = jRows[0];
      if (!jugador) { const e = new Error('Jugador no encontrado'); e.status = 404; throw e; }

      const { rows: rRows } = await client.query(
        `SELECT * FROM recompensas WHERE id = $1 AND activo = true`, [req.params.id]
      );
      const recompensa = rRows[0];
      if (!recompensa) { const e = new Error('Recompensa no encontrada'); e.status = 404; throw e; }

      if (jugador.puntos_totales < recompensa.costo_puntos) {
        const e = new Error('No tienes puntos suficientes para este canje.'); e.status = 400; throw e;
      }

      await client.query(
        `UPDATE jugadores SET puntos_totales = puntos_totales - $2 WHERE id = $1`,
        [jugador.id, recompensa.costo_puntos]
      );

      // Serial/hash solo si la recompensa es una constancia (mismo patrón
      // de reintento por colisión que capacitacion.js).
      let fila = null;
      const emitidaAt = new Date();
      for (let intento = 0; intento < 5 && !fila; intento++) {
        const s = recompensa.tipo === 'constancia' ? generarSerialCanje() : null;
        const h = s ? hashCanje({
          serial: s, jugador_id: jugador.id, recompensa_codigo: recompensa.codigo,
          puntos_gastados: recompensa.costo_puntos, emitida_at: emitidaAt,
        }) : null;
        try {
          const { rows } = await client.query(
            `INSERT INTO canjes (jugador_id, recompensa_id, puntos_gastados, serial, hash, created_at)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [jugador.id, recompensa.id, recompensa.costo_puntos, s, h, emitidaAt]
          );
          fila = rows[0];
        } catch (e) {
          if (e.code !== '23505') throw e;
        }
      }
      if (!fila) { const e = new Error('No se pudo generar el canje, intenta de nuevo.'); e.status = 500; throw e; }
      return { ...fila, recompensa_nombre: recompensa.nombre, recompensa_tipo: recompensa.tipo };
    });
    await logActividad({ accion: 'juego_canje', entidad: 'canje', entidadId: canje.id, ip: req.ip });
    res.status(201).json({ canje });
    // Export al data warehouse (no bloqueante; apagado por defecto).
    bigquery.exportCanje(canje);
  } catch (err) { next(err); }
});

const MODOS_TRANSPORTE = ['caminando', 'bicicleta', 'transporte_publico', 'auto', 'moto', 'otro'];

// ---------- POST /trayecto/salida ----------
router.post('/trayecto/salida', async (req, res, next) => {
  try {
    const modo = String(req.body?.modo_transporte || '');
    if (!MODOS_TRANSPORTE.includes(modo)) {
      return res.status(400).json({ error: 'Indica un medio de transporte válido.' });
    }
    const { rows } = await query(
      `INSERT INTO trayectos (jugador_id, modo_transporte) VALUES ($1, $2) RETURNING *`,
      [req.user.jugadorId, modo]
    );
    res.status(201).json({ trayecto: rows[0] });
  } catch (err) { next(err); }
});

// ---------- POST /trayecto/:id/llegada ----------
router.post('/trayecto/:id/llegada', async (req, res, next) => {
  try {
    const { trayecto, eventos } = await withTx(async (client) => {
      const { rows: tRows } = await client.query(
        `SELECT * FROM trayectos WHERE id = $1 AND jugador_id = $2 FOR UPDATE`,
        [req.params.id, req.user.jugadorId]
      );
      const t = tRows[0];
      if (!t) { const e = new Error('Trayecto no encontrado'); e.status = 404; throw e; }
      if (t.llegada_at) { const e = new Error('Este trayecto ya fue cerrado.'); e.status = 400; throw e; }

      const llegadaAt = new Date();
      const puntos = calcularPuntosTrayecto({
        modoTransporte: t.modo_transporte, salidaAt: t.salida_at, llegadaAt,
      });
      const { rows } = await client.query(
        `UPDATE trayectos SET llegada_at = $2, puntos = $3 WHERE id = $1 RETURNING *`,
        [t.id, llegadaAt, puntos]
      );
      const eventos = [];
      const eventoTrayecto = await otorgarPuntos(client, {
        jugadorId: req.user.jugadorId, tipo: 'trayecto_registrado', puntos, trayectoId: t.id,
      });
      if (eventoTrayecto) eventos.push(eventoTrayecto);
      // Solo un trayecto de bajo carbono avanza la misión 'primer_trayecto_verde'
      // (su descripción exige caminando/bicicleta/transporte público).
      if (esModoBajoCarbono(t.modo_transporte)) {
        const eventosMision = await evaluarMisionesContador(client, {
          jugadorId: req.user.jugadorId, tipoMision: 'contar_trayectos', incremento: 1,
        });
        eventos.push(...eventosMision);
      }
      return { trayecto: rows[0], eventos };
    });
    res.json({ trayecto });
    // Export al data warehouse (no bloqueante; apagado por defecto).
    bigquery.exportTrayecto(trayecto);
    eventos.forEach((e) => bigquery.exportPuntosEvento(e));
  } catch (err) { next(err); }
});

export default router;
