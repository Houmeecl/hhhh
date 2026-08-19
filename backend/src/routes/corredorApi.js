import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../config.js';
import { queryCorredor, withTxCorredor } from '../lib/dbCorredor.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import {
  requireCorredorActivo, requireAuthCorredor, requireClaveDefinida,
  requireAdminCorredor, exportadorDeLaSesion, firmarTokenCorredor, logCorredor,
} from '../middleware/authCorredor.js';
import {
  generarCodigoCarga, validarParcela, nivelConfianzaParcela, resumenParcela, puntoDe,
  EXIGE_POLIGONO_HA, TOLERANCIA_AREA_PCT, NOMBRE_NIVEL_PARCELA,
} from '../services/corredor.js';
import { listoParaExportar, semaforoExportacion, glosaExportacion, urgenciaExportacion } from '../services/exportacion.js';

// ============================================================
// API del Corredor Bioceánico — sobre su PROPIA base.
//
// Todo lo de acá consulta con queryCorredor, nunca con query: son bases
// distintas y no se mezclan. Un `query(...)` en este archivo iría contra
// sicr3p y sería un error silencioso —la consulta correría, contra la
// tabla equivocada—, así que ese import no está a propósito.
//
// Se llama corredorApi.js y no corredor.js porque ese nombre ya lo ocupan
// las rutas del Corredor del panel ADMIN (metodologías por país,
// documentos, puntos de control), que viven en la base de sicr3p y no
// tienen nada que ver con esto.
//
// EL AISLAMIENTO ENTRE EMPRESAS. El exportador de un operador sale del
// TOKEN, nunca del request (`exportadorDeLaSesion`). Es lo que impide que
// alguien vea las cargas de otra empresa cambiando un id en la URL, y es
// la garantía sobre la que se apoya todo lo demás.
// ============================================================

const router = express.Router();

// Nada del Corredor responde si el Corredor no está configurado. Va
// primero: si falta la base, el problema no es que falte el token.
router.use(requireCorredorActivo);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Sesión ----------

router.post('/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Correo y contraseña son obligatorios.' });

    const { rows } = await queryCorredor(
      `SELECT u.*, e.nombre_empresa, e.onboarding_completado_at
         FROM usuarios_corredor u
         LEFT JOIN exportadores e ON e.id = u.exportador_id
        WHERE u.email = $1`,
      [email]
    );
    const u = rows[0];
    // Mismo mensaje para "no existe" y "clave mala": distinguirlos le
    // confirma a quien prueba correos cuáles están registrados.
    const ok = u && u.estado === 'activo' && await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });

    await queryCorredor('UPDATE usuarios_corredor SET ultimo_acceso = now() WHERE id = $1', [u.id]);
    await logCorredor({ usuarioId: u.id, email, accion: 'login', ip: req.ip });

    res.json({
      access: firmarTokenCorredor(u),
      usuario: {
        id: u.id, email: u.email, nombre: u.nombre, rol: u.rol,
        exportador_id: u.exportador_id, nombre_empresa: u.nombre_empresa,
        must_reset_password: u.must_reset_password,
        onboarding_completado: u.onboarding_completado_at != null,
      },
    });
  } catch (err) { next(err); }
});

router.get('/me', requireAuthCorredor, async (req, res, next) => {
  try {
    const { rows } = await queryCorredor(
      `SELECT u.id, u.email, u.nombre, u.rol, u.exportador_id, u.must_reset_password,
              e.nombre_empresa, e.rut, e.eori, e.onboarding_completado_at
         FROM usuarios_corredor u
         LEFT JOIN exportadores e ON e.id = u.exportador_id
        WHERE u.id = $1`,
      [req.usuario.sub]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Sesión inválida.' });
    const u = rows[0];
    res.json({ usuario: { ...u, onboarding_completado: u.onboarding_completado_at != null } });
  } catch (err) { next(err); }
});

router.post('/auth/cambiar-password', requireAuthCorredor, async (req, res, next) => {
  try {
    const nueva = String(req.body?.password || '');
    if (nueva.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    const hash = await bcrypt.hash(nueva, config.bcryptRounds);
    await queryCorredor(
      'UPDATE usuarios_corredor SET password_hash = $2, must_reset_password = false WHERE id = $1',
      [req.usuario.sub, hash]
    );
    await logCorredor({ usuarioId: req.usuario.sub, email: req.usuario.email, accion: 'cambiar_password', ip: req.ip });
    // Token nuevo: el viejo lleva must_reset_password=true y seguiría
    // bloqueando todo lo demás hasta que expire.
    const { rows } = await queryCorredor('SELECT * FROM usuarios_corredor WHERE id = $1', [req.usuario.sub]);
    res.json({ ok: true, access: firmarTokenCorredor(rows[0]) });
  } catch (err) { next(err); }
});

// ---------- Alta de exportadores (administración del Corredor) ----------

router.post('/exportadores', requireAuthCorredor, requireClaveDefinida, requireAdminCorredor, async (req, res, next) => {
  try {
    const b = req.body || {};
    const nombre = String(b.nombre_empresa || '').trim();
    const rut = String(b.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
    const email = String(b.contacto_email || '').toLowerCase().trim();
    if (!nombre) return res.status(400).json({ error: 'La razón social es obligatoria.' });
    if (!rut) return res.status(400).json({ error: 'El identificador tributario es obligatorio.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Ingresa un correo válido.' });

    // Alfabeto sin caracteres ambiguos (sin 0/O, 1/l/I): esta clave se
    // dicta por teléfono cuando el correo no llega.
    const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(12);
    let temporal = '';
    for (let i = 0; i < 12; i++) temporal += ALFABETO[bytes[i] % ALFABETO.length];

    const salida = await withTxCorredor(async (client) => {
      const { rows: ex } = await client.query(
        `INSERT INTO exportadores (nombre_empresa, rut, pais, eori, contacto_email, contacto_nombre)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (rut) DO NOTHING
         RETURNING *`,
        [nombre, rut, String(b.pais || 'CL').toUpperCase(), b.eori || null, email, b.contacto_nombre || null]
      );
      if (!ex[0]) { const e = new Error('Ya existe un exportador con ese identificador.'); e.status = 409; throw e; }
      const hash = await bcrypt.hash(temporal, config.bcryptRounds);
      const { rows: us } = await client.query(
        `INSERT INTO usuarios_corredor (email, nombre, password_hash, exportador_id, rol, must_reset_password)
         VALUES ($1,$2,$3,$4,'operador',true) RETURNING id, email`,
        [email, b.contacto_nombre || nombre, hash, ex[0].id]
      );
      return { exportador: ex[0], usuario: us[0] };
    });

    await logCorredor({
      usuarioId: req.usuario.sub, email: req.usuario.email, accion: 'crear_exportador',
      entidad: 'exportador', entidadId: salida.exportador.id, detalle: { rut }, ip: req.ip,
    });
    // La clave temporal viaja UNA sola vez, en este response, y no queda
    // en la bitácora.
    res.status(201).json({ ...salida, password_temporal: temporal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'Ese correo ya tiene una cuenta en el Corredor.' });
    next(err);
  }
});

// ---------- Parcelas ----------

router.get('/parcelas', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    const exportador = exportadorDeLaSesion(req);
    if (!exportador) return res.json({ parcelas: [] });
    const { rows } = await queryCorredor(
      `SELECT * FROM parcelas WHERE exportador_id = $1 ORDER BY created_at DESC`, [exportador]
    );
    res.json({
      parcelas: rows.map((p) => ({ ...p, ...resumenParcela(p) })),
      umbral_poligono_ha: EXIGE_POLIGONO_HA,
      tolerancia_area_pct: TOLERANCIA_AREA_PCT,
      niveles: NOMBRE_NIVEL_PARCELA,
    });
  } catch (err) { next(err); }
});

router.post('/parcelas', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    const exportador = exportadorDeLaSesion(req);
    if (!exportador) return res.status(403).json({ error: 'Tu cuenta no tiene una empresa asociada.' });

    const b = req.body || {};
    const val = validarParcela(b);
    if (!val.ok) return res.status(400).json({ error: val.error });

    // EL NIVEL SE CALCULA, NUNCA SE RECIBE. Si `b.nivel_confianza` llegara
    // a la base, cualquiera se pondría en 4 con un curl. Lo mismo con los
    // campos de validación: un exportador no puede certificarse a sí mismo
    // contra un registro público — eso lo escribe el servidor cuando de
    // verdad contrasta, en otra ruta.
    const nivel = nivelConfianzaParcela({ ...b, validado_por: null, validado_fuente: null, validado_at: null });

    const { rows } = await queryCorredor(
      `INSERT INTO parcelas
         (exportador_id, nombre, pais, region, area_ha, lat, lng, poligono,
          origen_coordenada, precision_declarada_m, nivel_confianza)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [exportador, String(b.nombre).trim(), String(b.pais).toUpperCase(), b.region || null,
       b.area_ha ?? null, b.lat ?? null, b.lng ?? null,
       b.poligono ? JSON.stringify(b.poligono) : null,
       b.origen_coordenada || 'archivo', b.precision_declarada_m ?? null, nivel]
    );
    const p = rows[0];
    await logCorredor({
      usuarioId: req.usuario.sub, email: req.usuario.email, accion: 'crear_parcela',
      entidad: 'parcela', entidadId: p.id, detalle: { nivel, origen: p.origen_coordenada }, ip: req.ip,
    });
    res.status(201).json({ parcela: { ...p, ...resumenParcela(p) } });
  } catch (err) { next(err); }
});

// ---------- Cargas ----------

router.get('/cargas', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    const exportador = exportadorDeLaSesion(req);
    if (!exportador) return res.json({ cargas: [] });
    const { rows } = await queryCorredor(
      `SELECT * FROM cargas WHERE exportador_id = $1 ORDER BY created_at DESC LIMIT 300`, [exportador]
    );
    res.json({
      cargas: rows.map((c) => {
        const estado = listoParaExportar(c);
        return { ...c, exportacion: { ...estado, semaforo: semaforoExportacion(estado), glosa: glosaExportacion(estado) } };
      }),
    });
  } catch (err) { next(err); }
});

router.post('/cargas', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    const exportador = exportadorDeLaSesion(req);
    if (!exportador) return res.status(403).json({ error: 'Tu cuenta no tiene una empresa asociada.' });

    const b = req.body || {};
    const descripcion = String(b.descripcion || '').trim();
    if (!descripcion) return res.status(400).json({ error: 'La carga necesita una descripción.' });
    const cantidad = Number(b.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return res.status(400).json({ error: 'La cantidad tiene que ser mayor que 0.' });
    if (!/^[A-Z]{2}$/.test(String(b.pais_origen || '').toUpperCase())) {
      return res.status(400).json({ error: 'El país de origen va en ISO-2.' });
    }

    const carga = await withTxCorredor(async (client) => {
      const anio = new Date().getFullYear();
      // El correlativo se toma DENTRO de la transacción y con el año en el
      // LIKE: sin eso, dos altas simultáneas se llevan el mismo número y
      // choca el UNIQUE del código.
      const { rows: n } = await client.query(
        `SELECT count(*)::int + 1 AS n FROM cargas WHERE codigo LIKE $1`, [`CB-${anio}-%`]
      );
      const { rows } = await client.query(
        `INSERT INTO cargas
           (codigo, exportador_id, codigo_nc, descripcion, cantidad, unidad, pais_origen,
            region_origen, instalacion, emisiones_directas_tco2e_t, emisiones_indirectas_tco2e_t, metodo_emisiones)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [generarCodigoCarga(anio, n[0].n), exportador, b.codigo_nc || null, descripcion, cantidad,
         b.unidad || 't', String(b.pais_origen).toUpperCase(), b.region_origen || null,
         b.instalacion || null, b.emisiones_directas_tco2e_t ?? null,
         b.emisiones_indirectas_tco2e_t ?? null, b.metodo_emisiones || null]
      );
      return rows[0];
    });

    await logCorredor({
      usuarioId: req.usuario.sub, email: req.usuario.email, accion: 'crear_carga',
      entidad: 'carga', entidadId: carga.id, detalle: { codigo: carga.codigo }, ip: req.ip,
    });
    const estado = listoParaExportar(carga);
    res.status(201).json({
      carga,
      exportacion: { ...estado, semaforo: semaforoExportacion(estado), glosa: glosaExportacion(estado), urgencia: urgenciaExportacion(estado) },
    });
  } catch (err) { next(err); }
});

router.get('/cargas/:id', requireAuthCorredor, requireClaveDefinida, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Carga no encontrada.' });
    const exportador = exportadorDeLaSesion(req);
    // El exportador va en el WHERE: "no existe" cubre también "no es
    // tuya", que es lo que hay que responder — decir "existe pero no es
    // tuya" ya confirma que existe.
    const { rows } = await queryCorredor(
      `SELECT * FROM cargas WHERE id = $1 AND exportador_id = $2`, [req.params.id, exportador]
    );
    const carga = rows[0];
    if (!carga) return res.status(404).json({ error: 'Carga no encontrada.' });

    const [{ rows: parcelas }, { rows: produccion }, { rows: pasos }] = await Promise.all([
      queryCorredor(
        `SELECT p.*, cp.aporte_pct FROM carga_parcelas cp
           JOIN parcelas p ON p.id = cp.parcela_id
          WHERE cp.carga_id = $1`, [carga.id]),
      queryCorredor('SELECT * FROM carga_produccion WHERE carga_id = $1', [carga.id]),
      queryCorredor(
        `SELECT cp.*, pc.nombre AS punto_nombre, pc.pais AS punto_pais
           FROM carga_pasos cp JOIN puntos_corredor pc ON pc.id = cp.punto_id
          WHERE cp.carga_id = $1 ORDER BY cp.registrado_at`, [carga.id]),
    ]);

    // El estado de exportación se arma con la carga MÁS lo que cuelga de
    // ella: sin las parcelas y la producción, una carga de soya siempre
    // diría que le falta la geolocalización.
    const paraEvaluar = {
      ...carga,
      // `puntoDe` resuelve el centroide cuando la parcela se declaró solo
      // con polígono, que es el caso obligatorio sobre 4 ha. Sin esto, la
      // parcela mejor declarada de todas figuraba como sin geolocalizar.
      parcelas: parcelas.map((p) => ({ ...puntoDe(p), poligono: p.poligono })),
      fecha_produccion: produccion[0]?.desde || null,
      libre_deforestacion: produccion[0]?.libre_deforestacion_declarado === true,
      legalidad: produccion[0]?.legalidad_declarada === true,
    };
    const estado = listoParaExportar(paraEvaluar);

    res.json({
      carga,
      parcelas: parcelas.map((p) => ({ ...p, ...resumenParcela(p) })),
      produccion: produccion[0] || null,
      pasos,
      exportacion: {
        ...estado,
        semaforo: semaforoExportacion(estado),
        glosa: glosaExportacion(estado),
        urgencia: urgenciaExportacion(estado),
      },
    });
  } catch (err) { next(err); }
});

export default router;
