import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { requireAuth, requireHomePanel, requireSeccion, requireRole, logActividad } from '../middleware/auth.js';
import { leerTabla, proponerMapeo, normalizarClave } from '../services/tabla.js';
import {
  prepararDestinatarios, importarDestinatarios, enviarLinkPago, enviarTanda,
  registrarPagoYEntregar, enviarCredenciales, vistaPublica, urlDePago,
} from '../services/cobros.js';
import { pasarelaActiva, puedeCobrar, crearPagoFlow, estadoPagoFlow } from '../services/pagos.js';
import { darDeBaja, correosDadosDeBaja } from '../services/correoLog.js';

// ============================================================
// Campañas de cobro: importar la lista, mandar el link, cobrar y
// entregar el acceso solo.
//
// Dos routers en un archivo porque son las dos mitades de lo mismo y
// separarlos obligaría a duplicar los servicios y a leerlos por partes
// (mismo criterio que routes/pos.js):
//  · `adminRouter`  — panel, autenticado y con sección 'cobros'.
//  · `publicRouter` — la página de pago y el aviso de la pasarela. SIN
//                     autenticación por definición: quien paga no tiene
//                     cuenta todavía, y el webhook lo llama un servidor
//                     ajeno.
// ============================================================

// ---------- panel ----------

export const adminRouter = express.Router();
adminRouter.use(requireAuth, requireHomePanel('sicrep'), requireSeccion('cobros'));
const soloAdmin = requireRole('admin');

// La planilla se lee entera en memoria (el archivo real pesa 2,3 MB con
// 15.000 filas). 20 MB es holgado y sigue siendo un techo: sin límite,
// una subida cualquiera puede tumbar el proceso.
const subirPlanilla = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|csv|txt|tsv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Sube un archivo .xlsx o .csv.'), ok);
  },
}).single('archivo');

function conPlanilla(req, res, next) {
  subirPlanilla(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        error: err.code === 'LIMIT_FILE_SIZE'
          ? 'La planilla debe pesar menos de 20 MB.'
          : 'No se pudo procesar la subida.',
      });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Falta la planilla.' });
    next();
  });
}

// El mapeo llega como JSON dentro de un multipart, así que es texto.
function leerMapeo(crudo) {
  if (!crudo) return null;
  try {
    const m = typeof crudo === 'string' ? JSON.parse(crudo) : crudo;
    const salida = {};
    for (const campo of ['empresa', 'rut', 'contacto', 'email', 'monto']) {
      const v = Number(m[campo]);
      if (Number.isInteger(v) && v >= 0) salida[campo] = v;
    }
    return salida;
  } catch { return null; }
}

// ---------- campañas ----------

adminRouter.get('/campanas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT k.*,
              count(c.id)::int AS total,
              count(c.id) FILTER (WHERE c.estado = 'pendiente')::int AS pendientes,
              count(c.id) FILTER (WHERE c.estado = 'enviado')::int   AS enviados,
              count(c.id) FILTER (WHERE c.estado = 'pagado')::int    AS pagados_sin_entregar,
              count(c.id) FILTER (WHERE c.estado = 'entregado')::int AS entregados,
              COALESCE(sum(c.monto_clp) FILTER (WHERE c.estado IN ('pagado','entregado')), 0)::bigint AS recaudado_clp
         FROM campanas_cobro k LEFT JOIN cobros c ON c.campana_id = k.id
        GROUP BY k.id ORDER BY k.created_at DESC`
    );
    res.json({ campanas: rows, pasarela: pasarelaActiva(), envio: puedeCobrar() });
  } catch (err) { next(err); }
});

adminRouter.post('/campanas', soloAdmin, async (req, res, next) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    const monto = Math.round(Number(req.body.monto_clp));
    const creditos = Number(req.body.creditos);
    if (!nombre) return res.status(400).json({ error: 'La campaña necesita un nombre.' });
    if (!Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({ error: 'El monto debe ser un número mayor que cero.' });
    }
    if (!Number.isInteger(creditos) || creditos < 1 || creditos > 1000) {
      return res.status(400).json({ error: 'Los documentos incluidos deben ir entre 1 y 1000.' });
    }
    const { rows } = await query(
      `INSERT INTO campanas_cobro (nombre, descripcion, monto_clp, creditos, creado_por)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nombre, String(req.body.descripcion || '').trim() || null, monto, creditos, req.user.sub]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'crear_campana_cobro', entidad: 'campana_cobro',
      entidadId: rows[0].id, detalle: { nombre, monto }, ip: req.ip,
    });
    res.status(201).json({ campana: rows[0] });
  } catch (err) { next(err); }
});

adminRouter.put('/campanas/:id', soloAdmin, async (req, res, next) => {
  try {
    const { activa } = req.body;
    const { rows } = await query(
      `UPDATE campanas_cobro SET activa = COALESCE($2, activa) WHERE id = $1 RETURNING *`,
      [req.params.id, typeof activa === 'boolean' ? activa : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Campaña no encontrada.' });
    await logActividad({
      usuarioId: req.user.sub, accion: 'pausar_campana_cobro', entidad: 'campana_cobro',
      entidadId: req.params.id, detalle: { activa: rows[0].activa }, ip: req.ip,
    });
    res.json({ campana: rows[0] });
  } catch (err) { next(err); }
});

// ---------- importar la lista ----------

// Vista previa: lee la planilla y NO guarda nada. Existe porque una
// lista real no viene con encabezados prolijos — la que motivó esto
// tiene 6 pestañas, tres sin títulos y hasta tres columnas de correo.
// Adivinar y escribir 7.000 filas mal es mucho peor que mostrar primero
// lo que se entendió y dejar que una persona lo corrija.
adminRouter.post('/campanas/:id/previsualizar', conPlanilla, async (req, res, next) => {
  try {
    const { rows: cam } = await query(`SELECT * FROM campanas_cobro WHERE id = $1`, [req.params.id]);
    if (!cam[0]) return res.status(404).json({ error: 'Campaña no encontrada.' });

    let tabla;
    try {
      tabla = leerTabla(req.file.buffer, { hoja: req.body.hoja || null });
    } catch (e) {
      return res.status(422).json({ error: e.message });
    }

    const propuesta = req.body.mapeo ? null : proponerMapeo(tabla.filas);
    const mapeo = leerMapeo(req.body.mapeo) || propuesta?.mapeo || {};
    const desde = req.body.desde != null ? Number(req.body.desde) : (propuesta?.desde ?? 0);
    const prep = prepararDestinatarios(tabla.filas, mapeo, { desde, montoDefecto: cam[0].monto_clp });

    res.json({
      hojas: tabla.hojas,
      hoja: tabla.hoja,
      filas: tabla.filas.length,
      encabezado: propuesta?.encabezado ?? null,
      desde,
      mapeo,
      // Los títulos si los hay; si no, un nombre posicional para que el
      // selector de columnas no muestre índices pelados.
      columnas: (tabla.filas[0] || []).map((c, i) =>
        (propuesta?.encabezado && normalizarClave(c)) ? String(c).trim() : `Columna ${i + 1}`),
      // Suficiente para reconocer la planilla sin mandar 15.000 filas al navegador.
      muestra: tabla.filas.slice(desde, desde + 8),
      resumen: {
        admitidos: prep.admitidos.length,
        omitidos: prep.omitidos.length,
        duplicados: prep.duplicados,
      },
      // Solo los primeros descartes: alcanzan para entender el patrón.
      omitidos: prep.omitidos.slice(0, 15),
      ejemplos: prep.admitidos.slice(0, 5),
    });
  } catch (err) { next(err); }
});

adminRouter.post('/campanas/:id/importar', soloAdmin, conPlanilla, async (req, res, next) => {
  try {
    const { rows: cam } = await query(`SELECT * FROM campanas_cobro WHERE id = $1`, [req.params.id]);
    if (!cam[0]) return res.status(404).json({ error: 'Campaña no encontrada.' });

    let tabla;
    try {
      tabla = leerTabla(req.file.buffer, { hoja: req.body.hoja || null });
    } catch (e) {
      return res.status(422).json({ error: e.message });
    }
    // Acá el mapeo es OBLIGATORIO: importar es escribir, y escribir con
    // una adivinanza que nadie miró es justo lo que la vista previa
    // existe para evitar.
    const mapeo = leerMapeo(req.body.mapeo);
    if (!mapeo || mapeo.email == null) {
      return res.status(400).json({ error: 'Confirma primero qué columna tiene el correo (usa la vista previa).' });
    }
    const desde = Number(req.body.desde) || 0;
    const prep = prepararDestinatarios(tabla.filas, mapeo, { desde, montoDefecto: cam[0].monto_clp });
    if (!prep.admitidos.length) {
      return res.status(422).json({ error: 'No se encontró ningún correo válido con ese mapeo.', ...prep });
    }

    const r = await importarDestinatarios({
      campanaId: cam[0].id, destinatarios: prep.admitidos, montoCampana: cam[0].monto_clp,
    });
    await logActividad({
      usuarioId: req.user.sub, accion: 'importar_cobros', entidad: 'campana_cobro',
      entidadId: cam[0].id,
      detalle: { hoja: tabla.hoja, ...r, omitidos: prep.omitidos.length }, ip: req.ip,
    });
    res.status(201).json({
      ...r,
      omitidos: prep.omitidos.length,
      duplicados_en_planilla: prep.duplicados,
      hoja: tabla.hoja,
    });
  } catch (err) { next(err); }
});

// ---------- ver y enviar ----------

adminRouter.get('/campanas/:id/cobros', async (req, res, next) => {
  try {
    const estado = String(req.query.estado || '').trim();
    const { rows } = await query(
      `SELECT c.id, c.empresa, c.rut, c.contacto, c.email, c.monto_clp, c.estado,
              c.pasarela, c.pasarela_ref, c.notas,
              c.enviado_at, c.pagado_at, c.entregado_at, c.created_at,
              -- La CLAVE VENDIDA solo para rol admin. Un operador de la
              -- campaña necesita saber si se entregó (se lo dice la
              -- columna estado), no llevarse el listado completo de
              -- accesos pagados.
              -- OJO: nada de comillas invertidas dentro de esta consulta.
              -- Va en un template literal de JS, así que una comilla
              -- invertida en un comentario SQL lo cierra y el archivo
              -- deja de parsear entero.
              CASE WHEN $3 THEN k.codigo END AS codigo_entregado,
              (k.id IS NOT NULL) AS tiene_codigo,
              -- Solo los correos de CREDENCIALES: un fallo en el correo
              -- del link de pago no significa que el comprador se quedó
              -- sin su clave, y mezclarlos marcaba en rojo cobros
              -- perfectamente entregados.
              (SELECT bool_or(NOT e.ok) FROM correos_enviados e
                WHERE e.referencia = c.id::text AND e.tipo = 'credenciales') AS fallo_envio_clave
         FROM cobros c LEFT JOIN codigos_acceso k ON k.id = c.codigo_id
        WHERE c.campana_id = $1 AND ($2 = '' OR c.estado = $2)
        ORDER BY c.created_at LIMIT 500`,
      [req.params.id, estado, req.user.rol === 'admin']
    );
    res.json({ cobros: rows });
  } catch (err) { next(err); }
});

adminRouter.post('/cobros/:id/enviar', soloAdmin, async (req, res, next) => {
  try {
    const listo = puedeCobrar();
    if (!listo.ok) return res.status(409).json({ error: listo.error });
    const { rows } = await query(
      `SELECT c.*, k.nombre, k.creditos, k.activa
         FROM cobros c JOIN campanas_cobro k ON k.id = c.campana_id WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cobro no encontrado.' });
    // La consulta trae el cobro y su campaña en la misma fila; se separan
    // acá para que `enviarLinkPago` reciba lo que su firma dice recibir.
    const cobro = rows[0];
    const campana = { nombre: cobro.nombre, creditos: cobro.creditos, activa: cobro.activa };

    // Las MISMAS tres guardas que aplica el envío por tandas
    // (services/cobros.js `enviarTanda`). Este camino individual las
    // había quedado sin: mandaba el correo a quien pidió no recibir más
    // —incumpliendo el art. 28 B que la propia migración invoca— y
    // también a quien ya había pagado.
    if (!campana.activa) return res.status(409).json({ error: 'La campaña está pausada.' });
    if (!['pendiente', 'enviado'].includes(cobro.estado)) {
      return res.status(409).json({ error: `Este cobro está en estado "${cobro.estado}": no corresponde reenviar el link de pago.` });
    }
    const bajas = await correosDadosDeBaja([cobro.email]);
    if (bajas.has(cobro.email.toLowerCase())) {
      return res.status(409).json({ error: 'Este correo pidió no recibir más comunicaciones comerciales.' });
    }

    const r = await enviarLinkPago(cobro, campana);
    await logActividad({
      usuarioId: req.user.sub, accion: 'enviar_link_pago', entidad: 'cobro',
      entidadId: cobro.id, detalle: { correo_ok: r.correo_ok }, ip: req.ip,
    });
    res.json({ ...r, link: urlDePago(cobro.token) });
  } catch (err) { next(err); }
});

// Envío por tandas. El tope está en config (COBROS_LOTE_MAX) y no en la
// petición: quien opera la campaña no debería poder soltar 7.000 correos
// de una vez ni por error ni por apuro.
adminRouter.post('/campanas/:id/enviar-tanda', soloAdmin, async (req, res, next) => {
  try {
    const listo = puedeCobrar();
    if (!listo.ok) return res.status(409).json({ error: listo.error });
    const r = await enviarTanda({ campanaId: req.params.id, limite: req.body?.limite });
    if (r.error) return res.status(409).json(r);
    await logActividad({
      usuarioId: req.user.sub, accion: 'enviar_tanda_cobros', entidad: 'campana_cobro',
      entidadId: req.params.id, detalle: r, ip: req.ip,
    });
    res.json(r);
  } catch (err) { next(err); }
});

// Confirmación manual — el camino de la transferencia bancaria, y la
// red de seguridad cuando una pasarela no avisó. Entrega el acceso por
// el mismo camino que el webhook, así que un pago confirmado a mano y
// uno automático no pueden divergir.
adminRouter.post('/cobros/:id/marcar-pagado', soloAdmin, async (req, res, next) => {
  try {
    const r = await registrarPagoYEntregar({
      cobroId: req.params.id,
      pasarela: 'manual',
      ref: String(req.body?.referencia || '').trim().slice(0, 120) || null,
    });
    if (r.error) return res.status(409).json({ error: r.error });
    await logActividad({
      usuarioId: req.user.sub, accion: 'confirmar_pago_manual', entidad: 'cobro',
      entidadId: req.params.id, detalle: { ya_estaba: r.ya_estaba }, ip: req.ip,
    });
    res.json({
      ok: true, ya_estaba: r.ya_estaba, codigo: r.codigo?.codigo,
      correo_ok: r.correo?.ok ?? null,
    });
  } catch (err) { next(err); }
});

// Reenvía la clave YA emitida. No emite una nueva ni vuelve a cobrar:
// es la salida cuando el correo de credenciales rebotó.
// `soloAdmin` no es decorativo: esto reenvía una CLAVE VENDIDA. Sin él,
// cualquier operador con la sección podía disparar el reenvío de
// cualquier acceso pagado.
adminRouter.post('/cobros/:id/reenviar-credenciales', soloAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, k.codigo, k.creditos FROM cobros c
         JOIN codigos_acceso k ON k.id = c.codigo_id WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Este cobro todavía no tiene un código emitido.' });
    const r = await enviarCredenciales(rows[0], { codigo: rows[0].codigo, creditos: rows[0].creditos });
    await logActividad({
      usuarioId: req.user.sub, accion: 'reenviar_credenciales', entidad: 'cobro',
      entidadId: req.params.id, detalle: { correo_ok: r.ok }, ip: req.ip,
    });
    res.json({ ok: r.ok, error: r.error });
  } catch (err) { next(err); }
});

adminRouter.get('/cobros/:id/correos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT tipo, asunto, transporte, ok, error, created_at FROM correos_enviados
        WHERE referencia = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({ correos: rows });
  } catch (err) { next(err); }
});

adminRouter.get('/bajas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT email, motivo, origen, created_at FROM bajas_correo ORDER BY created_at DESC LIMIT 500`
    );
    res.json({ bajas: rows });
  } catch (err) { next(err); }
});

// ---------- página pública de pago ----------

export const publicRouter = express.Router();

async function cargarPorToken(token) {
  const { rows } = await query(
    `SELECT c.*, k.nombre AS campana_nombre, k.descripcion, k.creditos, k.activa
       FROM cobros c JOIN campanas_cobro k ON k.id = c.campana_id
      WHERE c.token = $1`,
    [String(token || '')]
  );
  if (!rows[0]) return null;
  const c = rows[0];
  return {
    cobro: c,
    campana: { nombre: c.campana_nombre, descripcion: c.descripcion, creditos: c.creditos, activa: c.activa },
  };
}

publicRouter.get('/:token', async (req, res, next) => {
  try {
    const d = await cargarPorToken(req.params.token);
    if (!d) return res.status(404).json({ error: 'Este enlace de pago no existe o fue anulado.' });
    res.json(vistaPublica(d.cobro, d.campana));
  } catch (err) { next(err); }
});

// Arranca el pago en la pasarela y devuelve a dónde mandar al comprador.
// El monto NO viene del navegador: sale de la fila. Aceptarlo del cliente
// dejaría que cualquiera se cobre a sí mismo $1.
publicRouter.post('/:token/iniciar', async (req, res, next) => {
  try {
    const d = await cargarPorToken(req.params.token);
    if (!d) return res.status(404).json({ error: 'Este enlace de pago no existe o fue anulado.' });
    if (!d.campana.activa) return res.status(409).json({ error: 'Esta campaña está pausada.' });
    if (['pagado', 'entregado'].includes(d.cobro.estado)) {
      return res.status(409).json({ error: 'Este cobro ya está pagado.', estado: 'pagado' });
    }
    if (d.cobro.estado === 'anulado') return res.status(409).json({ error: 'Este cobro fue anulado.' });
    if (pasarelaActiva() !== 'flow') {
      return res.status(409).json({ error: 'El pago es por transferencia: los datos están en esta misma página.' });
    }
    const { url, ref } = await crearPagoFlow({
      cobro: d.cobro, asunto: `${d.campana.nombre} — sicr3p`,
    });
    await query(`UPDATE cobros SET pasarela = 'flow', pasarela_ref = $2 WHERE id = $1`, [d.cobro.id, ref]);
    res.json({ url });
  } catch (err) { next(err); }
});

// Para que la pantalla de "volviste del pago" sepa cuándo dejar de girar.
publicRouter.get('/:token/estado', async (req, res, next) => {
  try {
    const d = await cargarPorToken(req.params.token);
    if (!d) return res.status(404).json({ error: 'Enlace no encontrado.' });
    res.json({ estado: d.cobro.estado === 'entregado' ? 'pagado' : d.cobro.estado });
  } catch (err) { next(err); }
});

// Darse de baja. Hay tres caminos hasta acá y los tres tienen que valer:
//  · la página /pagar/:token/baja del sitio, que hace POST (el enlace
//    visible del pie del correo);
//  · el POST servidor-a-servidor de la baja en un clic (RFC 8058), que
//    disparan Gmail y Outlook desde el botón de su propia bandeja;
//  · el GET directo, para quien abre la URL a mano o cuando el
//    JavaScript del sitio no carga — ponerle una barrera técnica a una
//    oposición sería vaciar de contenido el derecho que el correo dice
//    respetar.
async function baja(req, res, next) {
  try {
    const d = await cargarPorToken(req.params.token);
    if (!d) return res.status(404).json({ error: 'Enlace no encontrado.' });
    // Se registra la baja y NADA MÁS. Antes esto además anulaba todos los
    // cobros vivos de esa dirección, y al colgar de un GET bastaba con
    // que el antivirus de correo o el prefetcher de Outlook siguiera el
    // enlace para cancelar una venta que nadie quiso cancelar.
    //
    // No hace falta anular acá: `enviarTanda` consulta la lista de bajas
    // antes de cada envío y es la que marca esos cobros como anulados,
    // así que el efecto es el mismo por un solo camino.
    await darDeBaja({ email: d.cobro.email, origen: 'enlace', motivo: 'Enlace del correo' });
    res.json({ ok: true, email: d.cobro.email });
  } catch (err) { next(err); }
}
publicRouter.get('/:token/baja', baja);
// El cliente de correo manda `List-Unsubscribe=One-Click` como
// form-urlencoded, no como JSON: sin este parser el cuerpo llega vacío y
// Express respondería 400 antes de tocar el handler. El cuerpo no se lee
// —el token de la URL es todo lo que hace falta—, pero tiene que poder
// parsearse.
publicRouter.post('/:token/baja', express.urlencoded({ extended: false, limit: '4kb' }), baja);

// ---------- webhook de la pasarela ----------

// Flow avisa con application/x-www-form-urlencoded, no JSON: el
// express.json() global de index.js no lo parsea. El parser va acá y
// solo acá, para no ampliar la superficie del resto de la API.
export const webhookRouter = express.Router();

// Forma de un token de Flow. No prueba nada —el estado igual se pregunta
// de vuelta—, pero evita que cualquier POST anónimo con basura provoque
// una petición saliente de hasta 15 s contra flow.cl.
const TOKEN_FLOW = /^[A-Za-z0-9_-]{10,200}$/;

webhookRouter.post('/flow/confirmar', express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
  // Se responde 200 pase lo que pase: Flow reintenta ante cualquier otra
  // cosa, y como el aviso no se cree (el estado se pregunta de vuelta),
  // un reintento no aporta nada salvo ruido. Los problemas se registran
  // en el log del servidor, no en el código de respuesta.
  const token = String(req.body?.token || '').trim();
  res.status(200).send('OK');

  // Sin Flow configurado no hay nada que confirmar. La ruta se monta
  // siempre (montarla condicionalmente escondería el 404 que ayuda a
  // diagnosticar), pero con la pasarela en 'manual' el HMAC se firmaría
  // con secreto vacío y saldría igual una petición a flow.cl: un
  // amplificador de tráfico gratis para cualquier anónimo.
  if (pasarelaActiva() !== 'flow') return;
  if (!TOKEN_FLOW.test(token)) return;

  try {
    const estado = await estadoPagoFlow(token);
    if (!estado.pagada) {
      console.log(`[cobros] Flow avisó del token ${token.slice(0, 8)}… con estado ${estado.estado}: no está pagada.`);
      return;
    }
    if (!estado.cobroId) return console.error('[cobros] Flow confirmó un pago sin commerceOrder.');
    const r = await registrarPagoYEntregar({
      cobroId: estado.cobroId, pasarela: 'flow', ref: estado.ref, montoPagado: estado.monto,
    });
    if (r.error) return console.error(`[cobros] pago Flow ${estado.ref} no se pudo entregar: ${r.error}`);
    if (r.ya_estaba) {
      // El reintento normal de Flow es silencioso. Un pago con OTRA
      // referencia sobre un cobro ya pagado es un cobro duplicado: queda
      // anotado en `cobros.notas` (services/cobros.js) y además se grita
      // acá, porque del otro lado hay una devolución pendiente.
      if (r.duplicado) {
        console.error(`[cobros] PAGO DUPLICADO en el cobro ${estado.cobroId}: referencia ${estado.ref}. Revisar devolución.`);
      }
      return;
    }
    if (!r.correo?.ok) {
      console.error(`[cobros] cobro ${estado.cobroId} pagado y con código emitido, pero el correo falló. Reenviar desde el panel.`);
    }
  } catch (e) {
    console.error('[cobros] error procesando la confirmación de Flow:', e.message);
  }
});

export default adminRouter;
