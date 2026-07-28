import express from 'express';
import { query, withTx } from '../lib/db.js';
import { crearVersion } from '../services/motorVersiones.js';
import { actualizarFactores } from '../services/actualizarFactores.js';
import { requireAuth, requireRole, requireHomePanel, logActividad } from '../middleware/auth.js';
import { config } from '../config.js';

// ============================================================
// Motor propio de cálculo — administración de categorías
// (factores, palabras clave) y estadística de uso propio/externo.
// El cálculo en sí vive en services/motorPropio.js y se aplica
// automáticamente en routes/public.js al subir un DTE XML (motor
// 'propio'), un PDF con capa de texto ('propio_texto') o una imagen
// JPG/PNG con OCR local ('propio_ocr').
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('sicrep'));
const adminOnly = requireRole('admin', 'operador');

router.get('/categorias', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM motor_categorias ORDER BY codigo`);
    res.json({ categorias: rows });
  } catch (err) { next(err); }
});

// Editar una categoría cambia cómo se calcula de aquí en adelante, así que
// congela una versión nueva del motor en la MISMA transacción. Las facturas
// ya calculadas siguen apuntando a la versión anterior y su informe la sigue
// citando: por eso versionar solo inserta, nunca reescribe.
router.put('/categorias/:codigo', adminOnly, async (req, res, next) => {
  try {
    const { nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg, nota_version } = req.body;
    const { categoria, version } = await withTx(async (client) => {
      const run = (sql, p) => client.query(sql, p);
      const { rows } = await run(
        `UPDATE motor_categorias SET
           nombre = COALESCE($2,nombre),
           unidad_fisica = COALESCE($3,unidad_fisica),
           factor_fisico_kgco2e = COALESCE($4,factor_fisico_kgco2e),
           factor_gasto_kgco2e_clp1000 = COALESCE($5,factor_gasto_kgco2e_clp1000),
           palabras_clave = COALESCE($6,palabras_clave),
           fuente = COALESCE($7,fuente),
           activo = COALESCE($8,activo),
           alcance_ghg = COALESCE($9,alcance_ghg),
           updated_at = now()
         WHERE codigo = $1 RETURNING *`,
        [
          req.params.codigo,
          nombre,
          unidad_fisica,
          factor_fisico_kgco2e != null ? Number(factor_fisico_kgco2e) : null,
          factor_gasto_kgco2e_clp1000 != null ? Number(factor_gasto_kgco2e_clp1000) : null,
          Array.isArray(palabras_clave) ? palabras_clave : null,
          fuente,
          activo != null ? Boolean(activo) : null,
          alcance_ghg != null ? String(alcance_ghg) : null,
        ]
      );
      if (!rows[0]) {
        const e = new Error('Categoría no encontrada'); e.status = 404; throw e;
      }
      const version = await crearVersion(run, {
        nota: String(nota_version || '').trim() || `Edición de la categoría "${rows[0].nombre}".`,
        origen: 'edicion_manual',
        creadaPor: req.user.sub,
      });
      return { categoria: rows[0], version };
    });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_categoria_motor', entidad: 'motor_categoria', entidadId: req.params.codigo, ip: req.ip });
    res.json({ categoria, version });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ---------- Versiones del motor (migración 051) ----------
// Historia de qué factores y qué fuentes estuvieron vigentes en cada
// momento. Es lo que permite que un informe emitido en marzo siga
// citando la metodología de marzo. Solo lectura: no hay endpoint para
// editar ni borrar una versión, y no debe haberlo.
router.get('/versiones', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT v.id, v.nota, v.origen, v.creada_at, u.nombre AS creada_por_nombre,
              COUNT(f.id)::int AS n_facturas
         FROM motor_versiones v
         LEFT JOIN usuarios u ON u.id = v.creada_por
         LEFT JOIN facturas f ON f.motor_version_id = v.id
        GROUP BY v.id, u.nombre
        ORDER BY v.id DESC`
    );
    res.json({ versiones: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ versiones: [] }); // migración sin correr
    next(err);
  }
});

// ---------- «Actualizar»: propuestas de factores (migración 052) ----------
// La IA busca y propone; el motor no se toca hasta que una persona aprueba.
// Ver services/actualizarFactores.js para el porqué de esa separación.

router.post('/actualizar', adminOnly, async (req, res, next) => {
  try {
    if (!actualizarFactores.enabled) {
      return res.status(503).json({ error: 'La búsqueda automática de fuentes no está configurada en este servidor.' });
    }
    const r = await actualizarFactores.buscar({ usuarioId: req.user.sub });
    await logActividad({ usuarioId: req.user.sub, accion: 'buscar_factores_actuales', entidad: 'motor', entidadId: 'actualizar', ip: req.ip });
    if (!r.ok) return res.status(502).json({ error: r.error });
    res.json({
      propuestas: r.propuestas,
      // Se informa lo descartado en vez de esconderlo: si el modelo devolvió
      // algo sin URL verificable, el admin merece saber que pasó.
      descartados: r.descartados.map((d) => d.motivo),
    });
  } catch (err) { next(err); }
});

router.get('/propuestas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, u.nombre AS resuelta_por_nombre
         FROM propuestas_factores p
         LEFT JOIN usuarios u ON u.id = p.resuelta_por
        ORDER BY (p.estado = 'pendiente') DESC, p.created_at DESC
        LIMIT 100`
    );
    res.json({ propuestas: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ propuestas: [] });
    next(err);
  }
});

// Aprobar es lo ÚNICO que escribe un factor propuesto por la IA, y lo hace
// bajo una firma humana: aplica el cambio y congela una versión nueva en la
// misma transacción, con la URL de la fuente en la nota para que quede
// dicho de dónde salió.
router.post('/propuestas/:id/aprobar', adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Propuesta no encontrada' });

    const { propuesta, version } = await withTx(async (client) => {
      const run = (sql, p) => client.query(sql, p);
      const { rows } = await run(
        `SELECT * FROM propuestas_factores WHERE id = $1 AND estado = 'pendiente' FOR UPDATE`, [id]);
      const p = rows[0];
      if (!p) { const e = new Error('Propuesta no encontrada o ya resuelta'); e.status = 404; throw e; }

      if (p.campo === 'fuente_version_anio') {
        // La edición del documento vive en fuentes_metodologicas, no en la
        // categoría: se actualiza la fuente vinculada a esa categoría.
        const { rowCount } = await run(
          `UPDATE fuentes_metodologicas SET version_anio = $2
            WHERE id = (SELECT fuente_metodologica_id FROM motor_categorias WHERE codigo = $1)`,
          [p.categoria_codigo, p.valor_propuesto]
        );
        if (!rowCount) {
          const e = new Error('Esa categoría no tiene una fuente metodológica vinculada.'); e.status = 400; throw e;
        }
      } else {
        // Nombre de columna desde un CHECK cerrado (tres valores), no desde
        // el cuerpo de la petición: no hay superficie de inyección acá.
        const { rowCount } = await run(
          `UPDATE motor_categorias SET ${p.campo} = $2, updated_at = now() WHERE codigo = $1`,
          [p.categoria_codigo, Number(p.valor_propuesto)]
        );
        if (!rowCount) { const e = new Error('La categoría ya no existe.'); e.status = 400; throw e; }
      }

      const v = await crearVersion(run, {
        nota: `Propuesta #${p.id} aprobada — ${p.categoria_codigo}.${p.campo}: ${p.valor_actual ?? '—'} → ${p.valor_propuesto}. Fuente: ${p.fuente_url}`,
        origen: 'propuesta_aprobada',
        creadaPor: req.user.sub,
      });
      const { rows: act } = await run(
        `UPDATE propuestas_factores
            SET estado = 'aprobada', resuelta_por = $2, resuelta_at = now(),
                motivo_resolucion = $3, version_creada_id = $4
          WHERE id = $1 RETURNING *`,
        [p.id, req.user.sub, String(req.body?.motivo || '').trim() || null, v.id]
      );
      return { propuesta: act[0], version: v };
    });

    await logActividad({ usuarioId: req.user.sub, accion: 'aprobar_propuesta_factor', entidad: 'propuesta_factor', entidadId: String(id), ip: req.ip });
    res.json({ propuesta, version });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Descartar deja constancia y conserva la fila: saber qué se rechazó y por
// qué es parte del respaldo metodológico, igual que saber qué se aprobó.
router.post('/propuestas/:id/descartar', adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Propuesta no encontrada' });
    const { rows } = await query(
      `UPDATE propuestas_factores
          SET estado = 'descartada', resuelta_por = $2, resuelta_at = now(), motivo_resolucion = $3
        WHERE id = $1 AND estado = 'pendiente' RETURNING *`,
      [id, req.user.sub, String(req.body?.motivo || '').trim() || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Propuesta no encontrada o ya resuelta' });
    await logActividad({ usuarioId: req.user.sub, accion: 'descartar_propuesta_factor', entidad: 'propuesta_factor', entidadId: String(id), ip: req.ip });
    res.json({ propuesta: rows[0] });
  } catch (err) { next(err); }
});

router.get('/versiones/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Versión no encontrada' });
    const { rows } = await query(
      `SELECT * FROM motor_categorias_version WHERE version_id = $1 ORDER BY codigo`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Versión no encontrada' });
    res.json({ categorias: rows });
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Versión no encontrada' });
    next(err);
  }
});

// ---------- Fuentes metodológicas (migración 018) ----------
// Registro citable de los documentos que avalan la METODOLOGÍA (IPCC,
// GHG Protocol, DEFRA, MMA, CEN, GLEC). Honestidad: avalan el método,
// no a sicr3p — nada aquí es un "certificado". Defensivo: si la tabla
// aún no existe (migración sin correr), la lista vuelve vacía en vez
// de romper el panel.
const ESTADOS_FUENTE = ['avalada_referencial', 'validada_oficial'];

router.get('/fuentes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.*, COUNT(mc.codigo)::int AS n_categorias
       FROM fuentes_metodologicas f
       LEFT JOIN motor_categorias mc ON mc.fuente_metodologica_id = f.id
       GROUP BY f.id
       ORDER BY f.organismo, f.codigo`
    );
    res.json({ fuentes: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ fuentes: [] }); // tabla aún no migrada
    next(err);
  }
});

// Edita lo administrable de una fuente: url, año/edición, notas y estado.
// 'validada_oficial' SOLO cuando el admin tiene descargada la edición
// vigente del documento; organismo/documento/código no se editan por API
// (son la identidad citable de la fuente).
router.put('/fuentes/:id', adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).json({ error: 'Fuente no encontrada' });
    }
    const { url, version_anio, estado, notas } = req.body;
    if (estado != null && !ESTADOS_FUENTE.includes(estado)) {
      return res.status(400).json({ error: "El estado debe ser 'avalada_referencial' o 'validada_oficial'." });
    }
    // Igual que al editar una categoría: cambiar el año o el estado de una
    // fuente cambia lo que se citará de aquí en adelante, así que se congela
    // una versión. Los informes ya emitidos NO se mueven — el snapshot
    // guarda el texto de la cita, no una FK a esta fila.
    const { fuente, version } = await withTx(async (client) => {
      const run = (sql, p) => client.query(sql, p);
      const { rows } = await run(
        `UPDATE fuentes_metodologicas SET
           url = COALESCE($2,url),
           version_anio = COALESCE($3,version_anio),
           estado = COALESCE($4,estado),
           notas = COALESCE($5,notas)
         WHERE id = $1 RETURNING *`,
        [
          id,
          url != null ? String(url).trim() : null,
          version_anio != null ? String(version_anio).trim() : null,
          estado != null ? String(estado) : null,
          notas != null ? String(notas) : null,
        ]
      );
      if (!rows[0]) {
        const e = new Error('Fuente no encontrada'); e.status = 404; throw e;
      }
      const v = await crearVersion(run, {
        nota: `Edición de la fuente "${rows[0].organismo} — ${rows[0].documento}".`,
        origen: 'edicion_manual',
        creadaPor: req.user.sub,
      });
      return { fuente: rows[0], version: v };
    });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_fuente_metodologica', entidad: 'fuente_metodologica', entidadId: String(id), ip: req.ip });
    res.json({ fuente, version });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'El registro de fuentes metodológicas aún no está disponible.' });
    }
    next(err);
  }
});

router.get('/estadisticas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT motor, COUNT(*)::int AS n FROM facturas GROUP BY motor`
    );
    const total = rows.reduce((a, r) => a + r.n, 0);
    const n = (motor) => rows.find((r) => r.motor === motor)?.n || 0;
    const propio = n('propio');
    const propio_texto = n('propio_texto');
    const propio_ocr = n('propio_ocr');
    const propio_ia = n('propio_ia');
    const propio_revisado = n('propio_revisado');
    const revision = n('revision');
    const externo = n('externo');
    // "Propio" para el % de independencia = XML + texto de PDF + OCR + IA
    // (+ conteos históricos de la revisión, hoy eliminada).
    const propioTotal = propio + propio_texto + propio_ocr + propio_ia + propio_revisado;

    // Bitácora de rechazos (migración 030) — documentos ilegibles que
    // nunca llegaron a ser factura. Defensivo si la migración no corrió.
    let rechazadosTotal = 0;
    let rechazados30d = 0;
    const rechazosPorMotivo = {};
    const rechazosPorEtapa = {};
    try {
      const { rows: rRows } = await query(
        `SELECT motivo, etapa_alcanzada,
                COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS n30
         FROM documentos_rechazados GROUP BY motivo, etapa_alcanzada`
      );
      for (const r of rRows) {
        rechazadosTotal += r.n;
        rechazados30d += r.n30;
        rechazosPorMotivo[r.motivo] = (rechazosPorMotivo[r.motivo] || 0) + r.n;
        rechazosPorEtapa[r.etapa_alcanzada] = (rechazosPorEtapa[r.etapa_alcanzada] || 0) + r.n;
      }
    } catch (err) {
      if (err.code !== '42P01') throw err; // tabla aún no migrada → todo en 0
    }

    // Análisis con IA (migración 033) — llamadas, éxito, latencia y costo
    // estimado, para transparencia del admin. Defensivo si aún no migró.
    let ia = { llamadas_30d: 0, exitosas_30d: 0, latencia_prom_ms: null, costo_estimado_clp_30d: 0 };
    try {
      const { rows: iaRows } = await query(
        `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS llamadas,
                COUNT(*) FILTER (WHERE exito AND created_at > now() - interval '30 days')::int AS exitosas,
                COALESCE(AVG(latencia_ms) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS latencia_prom,
                COALESCE(SUM(costo_estimado_clp) FILTER (WHERE created_at > now() - interval '30 days'), 0)::numeric AS costo
         FROM analisis_ia_uso`
      );
      const r = iaRows[0];
      ia = {
        llamadas_30d: r.llamadas,
        exitosas_30d: r.exitosas,
        latencia_prom_ms: r.llamadas > 0 ? r.latencia_prom : null,
        costo_estimado_clp_30d: Number(r.costo),
      };
    } catch (err) {
      if (err.code !== '42P01') throw err; // tabla aún no migrada → todo en 0
    }

    // Método físico vs. por gasto (migración 035) — mide qué tan seguido el
    // motor calcula sobre un dato físico real (cantidad × factor) en vez de
    // caer al piso metodológico (monto × factor). Los NULL son ítems de
    // antes de la migración, o del motor externo (no calcula método): se
    // excluyen del porcentaje en vez de contarlos como "gasto".
    let metodoFisico = 0;
    let metodoGasto = 0;
    try {
      const { rows: mRows } = await query(
        `SELECT metodo, COUNT(*)::int AS n FROM line_items WHERE metodo IS NOT NULL GROUP BY metodo`
      );
      metodoFisico = mRows.find((r) => r.metodo === 'fisico')?.n || 0;
      metodoGasto = mRows.find((r) => r.metodo === 'gasto')?.n || 0;
    } catch (err) {
      if (err.code !== '42P01') throw err; // columna aún no migrada → todo en 0
    }
    const metodoTotal = metodoFisico + metodoGasto;

    res.json({
      total,
      propio,
      propio_texto,
      propio_ocr,
      propio_ia,
      propio_revisado,
      revision,
      externo,
      metodo_fisico_pct: metodoTotal > 0 ? Math.round((metodoFisico / metodoTotal) * 1000) / 10 : null,
      metodo_gasto_pct: metodoTotal > 0 ? Math.round((metodoGasto / metodoTotal) * 1000) / 10 : null,
      motor_externo_activo: String(process.env.MOTOR_EXTERNO || 'on').toLowerCase() !== 'off',
      analisis_ia_activo: config.analisisIA.enabled,
      analisis_ia: ia,
      porcentaje_propio: total > 0 ? Math.round((propioTotal / total) * 1000) / 10 : 0,
      rechazados_total: rechazadosTotal,
      rechazados_30d: rechazados30d,
      rechazos_por_motivo: rechazosPorMotivo,
      rechazos_por_etapa: rechazosPorEtapa,
      tasa_rechazo: (rechazadosTotal + total) > 0
        ? Math.round((rechazadosTotal / (rechazadosTotal + total)) * 1000) / 10
        : 0,
    });
  } catch (err) { next(err); }
});

export default router;
