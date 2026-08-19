import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireHomePanel, requireNivelOperador, logActividad } from '../middleware/auth.js';
import { normalizarRut } from '../services/mandante.js';
import { rutValido } from '../services/dte.js';
import {
  TIPOS_EXPEDIENTE, ESTADOS_EXPEDIENTE, ROLES_DOCUMENTO, ROLES_ESPERADOS_POR_TIPO,
  NOMBRE_ROL, validarDocumento, resumenExpediente, NO_ACREDITA, NOTA_SCOPE,
} from '../services/expediente.js';

// ============================================================
// Expedientes de evidencia desde el panel del proveedor
// (/api/panel-proveedor/expedientes).
//
// Cada factura de venta abre un expediente: el proveedor lo arma con lo
// que YA tiene —su RCV descargado del SII (dte_proveedor, migración 071) y
// las facturas cargadas en sicr3p— y ve, antes que su cliente, qué le
// falta para que ese número esté respaldado.
//
// NADA SALE DEL PROVEEDOR EN ESTA ETAPA. No hay endpoint que le muestre un
// expediente a un mandante: la divulgación selectiva es una pieza aparte y
// tiene un prerrequisito que no es de software (el contrato de encargo de
// tratamiento que exige la Ley 21.719). Construir primero el visor y
// después el permiso sería exactamente el orden equivocado.
//
// Todo está scopeado por req.user.proveedor_id, igual que rep y
// transporte: un id ajeno simplemente no aparece en el WHERE, así que
// "no existe" también cubre "no es tuyo" (mismo criterio que
// validarItemsVenta en services/repProveedor.js).
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('proveedor'));

// Un id que no es UUID hace fallar la consulta con un error de Postgres
// (22P02) y un 500; se responde 404, que es lo que realmente pasa. Misma
// convención que repProveedor.js:70, transporteProveedor.js y motor.js.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CAMPOS_EXPEDIENTE = `id, cliente_rut, cliente_nombre, orden_compra, contrato, faena,
  centro_costo, periodo, glosa, tipo, estado, created_at, updated_at`;

const CAMPOS_DOCUMENTO = `id, expediente_id, rol, asociacion, porcentaje, base_prorrateo,
  factura_id, dte_proveedor_id, descripcion, emisor_rut, tipo_dte, folio, fecha, monto,
  dato_id, cantidad, unidad, created_at`;

// Texto único del panel — para que la UI no reescriba la advertencia con
// otras palabras. La regla es la misma que en repProveedor.js con RETC.
const AVISO = 'Un expediente ordena y muestra la evidencia de una venta: qué documentos la '
  + 'respaldan y cuáles faltan. No es un cálculo de emisiones de tu cliente ni una '
  + 'certificación.';

// Lee el expediente y sus documentos scopeados al proveedor de la sesión.
// Devuelve null si no existe o no es suyo.
async function cargarExpediente(id, proveedorId) {
  if (!UUID_RE.test(String(id))) return null;   // 404, no 500
  const { rows } = await query(
    `SELECT ${CAMPOS_EXPEDIENTE} FROM expedientes WHERE id = $1 AND proveedor_id = $2`,
    [id, proveedorId]
  );
  if (!rows[0]) return null;
  const { rows: docs } = await query(
    `SELECT ${CAMPOS_DOCUMENTO} FROM expediente_documentos
      WHERE expediente_id = $1 ORDER BY created_at`,
    [id]
  );
  return { expediente: rows[0], documentos: docs };
}

// Saneo de los campos de texto del expediente. Vacío → NULL, no "": un
// string vacío en orden_compra entraría al índice parcial y agruparía
// expedientes sin OC como si compartieran una.
function texto(v, max = 120) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.slice(0, max);
}

// El período es la LLAVE del cruce con dte_proveedor.periodo en
// /candidatos. Guardarlo mal —o truncado a 7 caracteres, que era el bug:
// "julio 2026" quedaba como "julio 2"— deja el expediente sin candidatos
// para siempre y en silencio. Se valida en POST y en PUT con la misma
// función, porque la mitad de las correcciones llegan por PUT.
function periodoDe(v) {
  const p = texto(v, 20);
  if (p === null) return { ok: true, valor: null };
  if (!/^\d{4}-\d{2}$/.test(p)) {
    return { ok: false, error: 'El período debe ser AAAA-MM (por ejemplo 2026-07).' };
  }
  return { ok: true, valor: p };
}

// Un RUT mal tecleado se normaliza igual de bien que uno correcto, y el
// cruce por igualdad con dte_proveedor.rut_contraparte —la razón entera de
// normalizarlo— no calza nunca, sin que nadie se entere. El dígito
// verificador es lo único que atrapa eso acá. Vacío sigue siendo válido:
// el RUT del cliente es opcional.
function rutDe(v) {
  if (v === undefined) return { ok: true, valor: undefined };
  const bruto = String(v ?? '').trim();
  if (!bruto) return { ok: true, valor: null };
  const rut = normalizarRut(bruto);
  // OJO CON EL ORDEN: rutValido() (services/dte.js) EXIGE el guión —su
  // regexp es /^(\d{1,9})-([\dK])$/—, así que validar la forma ya
  // normalizada rechazaría hasta los RUT correctos. Se normaliza primero
  // (para guardar), y se valida sobre la forma con guión reconstruida.
  const conGuion = rut.length >= 2 ? `${rut.slice(0, -1)}-${rut.slice(-1)}` : rut;
  if (!rutValido(conGuion)) {
    return { ok: false, error: `El RUT «${bruto}» no es válido: revisa el dígito verificador.` };
  }
  return { ok: true, valor: rut };
}

// ---------- GET / — lista con su resumen ----------
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${CAMPOS_EXPEDIENTE} FROM expedientes
        WHERE proveedor_id = $1 ORDER BY created_at DESC`,
      [req.user.proveedor_id]
    );
    // Los documentos de todos los expedientes en UNA consulta: la lista
    // puede tener decenas de expedientes y una consulta por cada uno sería
    // el N+1 de siempre.
    const ids = rows.map((r) => r.id);
    const { rows: docs } = ids.length
      ? await query(
        `SELECT ${CAMPOS_DOCUMENTO} FROM expediente_documentos WHERE expediente_id = ANY($1::uuid[])`,
        [ids]
      )
      : { rows: [] };
    const porExpediente = new Map(ids.map((id) => [id, []]));
    for (const d of docs) porExpediente.get(d.expediente_id)?.push(d);

    res.json({
      expedientes: rows.map((e) => resumenExpediente(e, porExpediente.get(e.id) || [])),
      vocabulario: {
        tipos: TIPOS_EXPEDIENTE,
        estados: ESTADOS_EXPEDIENTE,
        roles: ROLES_DOCUMENTO.map((r) => ({ codigo: r, nombre: NOMBRE_ROL[r] })),
        roles_esperados_por_tipo: ROLES_ESPERADOS_POR_TIPO,
      },
      aviso: AVISO,
      no_acredita: NO_ACREDITA,
      nota_scope: NOTA_SCOPE,
    });
  } catch (err) { next(err); }
});

// ---------- GET /:id — un expediente con sus documentos ----------
router.get('/:id', async (req, res, next) => {
  try {
    const cargado = await cargarExpediente(req.params.id, req.user.proveedor_id);
    if (!cargado) return res.status(404).json({ error: 'Expediente no encontrado.' });
    res.json({
      expediente: cargado.expediente,
      documentos: cargado.documentos,
      resumen: resumenExpediente(cargado.expediente, cargado.documentos),
      aviso: AVISO,
    });
  } catch (err) { next(err); }
});

// ---------- POST / — abrir un expediente ----------
router.post('/', requireNivelOperador, async (req, res, next) => {
  try {
    const nombre = texto(req.body?.cliente_nombre, 200);
    if (!nombre) return res.status(400).json({ error: 'Indica el cliente del expediente.' });

    const tipo = String(req.body?.tipo || 'otro');
    if (!TIPOS_EXPEDIENTE.includes(tipo)) {
      return res.status(400).json({ error: `Tipo no válido. Usa: ${TIPOS_EXPEDIENTE.join(', ')}.` });
    }
    const per = periodoDe(req.body?.periodo);
    if (!per.ok) return res.status(400).json({ error: per.error });
    const periodo = per.valor;

    // Normalizado para que el cruce con el cliente sea por igualdad,
    // igual que dte_proveedor.rut_contraparte.
    const rutRes = rutDe(req.body?.cliente_rut);
    if (!rutRes.ok) return res.status(400).json({ error: rutRes.error });
    const rut = rutRes.valor ?? null;

    const { rows } = await query(
      `INSERT INTO expedientes
         (proveedor_id, cliente_rut, cliente_nombre, orden_compra, contrato, faena,
          centro_costo, periodo, glosa, tipo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${CAMPOS_EXPEDIENTE}`,
      [req.user.proveedor_id, rut, nombre, texto(req.body?.orden_compra, 60),
        texto(req.body?.contrato, 60), texto(req.body?.faena), texto(req.body?.centro_costo),
        periodo, texto(req.body?.glosa, 400), tipo]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'expediente_crear', entidad: 'expediente',
      entidadId: rows[0].id, detalle: { orden_compra: rows[0].orden_compra }, ip: req.ip,
    });
    res.status(201).json({
      expediente: rows[0],
      resumen: resumenExpediente(rows[0], []),
    });
  } catch (err) { next(err); }
});

// ---------- PUT /:id — corregir la carátula ----------
router.put('/:id', requireNivelOperador, async (req, res, next) => {
  try {
    const cargado = await cargarExpediente(req.params.id, req.user.proveedor_id);
    if (!cargado) return res.status(404).json({ error: 'Expediente no encontrado.' });

    const tipo = req.body?.tipo === undefined ? cargado.expediente.tipo : String(req.body.tipo);
    if (!TIPOS_EXPEDIENTE.includes(tipo)) {
      return res.status(400).json({ error: `Tipo no válido. Usa: ${TIPOS_EXPEDIENTE.join(', ')}.` });
    }
    const estado = req.body?.estado === undefined ? cargado.expediente.estado : String(req.body.estado);
    if (!ESTADOS_EXPEDIENTE.includes(estado)) {
      return res.status(400).json({ error: `Estado no válido. Usa: ${ESTADOS_EXPEDIENTE.join(', ')}.` });
    }
    const nombre = req.body?.cliente_nombre === undefined
      ? cargado.expediente.cliente_nombre
      : texto(req.body.cliente_nombre, 200);
    if (!nombre) return res.status(400).json({ error: 'Indica el cliente del expediente.' });

    // El período y el RUT se validan con las MISMAS funciones que el POST.
    // Antes el PUT solo truncaba a 7 caracteres: "julio 2026" entraba como
    // "julio 2" con un 200 alegre, y ese campo es la llave del cruce con el
    // RCV en /candidatos. Corregir la carátula es justamente donde más se
    // teclea, así que era el peor sitio donde dejar el hueco.
    const per = req.body?.periodo === undefined
      ? { ok: true, valor: cargado.expediente.periodo }
      : periodoDe(req.body.periodo);
    if (!per.ok) return res.status(400).json({ error: per.error });

    const rutRes = rutDe(req.body?.cliente_rut);
    if (!rutRes.ok) return res.status(400).json({ error: rutRes.error });
    const rut = rutRes.valor === undefined ? cargado.expediente.cliente_rut : rutRes.valor;

    const { rows } = await query(
      `UPDATE expedientes SET
         cliente_rut = $3, cliente_nombre = $4, orden_compra = $5, contrato = $6, faena = $7,
         centro_costo = $8, periodo = $9, glosa = $10, tipo = $11, estado = $12, updated_at = now()
       WHERE id = $1 AND proveedor_id = $2
       RETURNING ${CAMPOS_EXPEDIENTE}`,
      [req.params.id, req.user.proveedor_id,
        rut,
        nombre,
        req.body?.orden_compra === undefined
          ? cargado.expediente.orden_compra : texto(req.body.orden_compra, 60),
        req.body?.contrato === undefined ? cargado.expediente.contrato : texto(req.body.contrato, 60),
        req.body?.faena === undefined ? cargado.expediente.faena : texto(req.body.faena),
        req.body?.centro_costo === undefined
          ? cargado.expediente.centro_costo : texto(req.body.centro_costo),
        per.valor,
        req.body?.glosa === undefined ? cargado.expediente.glosa : texto(req.body.glosa, 400),
        tipo, estado]
    );
    await logActividad({
      usuarioId: req.user.sub, accion: 'expediente_editar', entidad: 'expediente',
      entidadId: req.params.id, detalle: { estado }, ip: req.ip,
    });
    const { rows: docs } = await query(
      `SELECT ${CAMPOS_DOCUMENTO} FROM expediente_documentos WHERE expediente_id = $1`,
      [req.params.id]
    );
    res.json({ expediente: rows[0], resumen: resumenExpediente(rows[0], docs) });
  } catch (err) { next(err); }
});

// ---------- GET /:id/candidatos — qué se puede enganchar ----------
// Las compras del propio RCV del proveedor, del mismo período. No se
// engancha nada solo: se PROPONE y el proveedor confirma. Un sistema que
// decidiera por su cuenta qué compra respalda qué venta estaría inventando
// la asociación, que es justo el dato que el expediente tiene que probar.
router.get('/:id/candidatos', async (req, res, next) => {
  try {
    const cargado = await cargarExpediente(req.params.id, req.user.proveedor_id);
    if (!cargado) return res.status(404).json({ error: 'Expediente no encontrado.' });

    const yaEnganchados = cargado.documentos.map((d) => d.dte_proveedor_id).filter(Boolean);
    const periodo = cargado.expediente.periodo;
    const { rows } = await query(
      `SELECT id, periodo, tipo_dte, folio, rut_contraparte, razon_social, total, fecha
         FROM dte_proveedor
        WHERE proveedor_id = $1 AND tipo = 'compra'
          AND ($2::text IS NULL OR periodo = $2)
          AND NOT (id = ANY($3::uuid[]))
        ORDER BY fecha DESC NULLS LAST, folio DESC
        LIMIT 200`,
      [req.user.proveedor_id, periodo, yaEnganchados]
    );
    res.json({
      candidatos: rows,
      periodo,
      nota: periodo
        ? `Compras de tu RCV del período ${periodo}. Tú confirmas cuáles respaldan esta venta `
          + 'y en qué proporción — sicr3p no lo decide por ti.'
        : 'Compras de tu RCV. Ponle período al expediente para acotar la lista.',
    });
  } catch (err) { next(err); }
});

// ---------- POST /:id/documentos — enganchar un documento ----------
router.post('/:id/documentos', requireNivelOperador, async (req, res, next) => {
  try {
    const cargado = await cargarExpediente(req.params.id, req.user.proveedor_id);
    if (!cargado) return res.status(404).json({ error: 'Expediente no encontrado.' });

    const v = validarDocumento(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const d = v.valor;

    // El vínculo tiene que ser del propio proveedor. Sin este chequeo, un
    // id de dte_proveedor ajeno entraría al expediente y el resumen diría
    // "respaldado" apoyándose en el RCV de otra empresa.
    if (d.dte_proveedor_id) {
      const { rows } = await query(
        `SELECT id FROM dte_proveedor WHERE id = $1 AND proveedor_id = $2`,
        [d.dte_proveedor_id, req.user.proveedor_id]
      );
      if (!rows[0]) return res.status(400).json({ error: 'Ese documento del RCV no es tuyo.' });
    }
    // El RUT del proveedor NO viaja en el JWT (solo proveedor_id, ver
    // middleware/auth.js), así que se lee de la tabla. Los RUT de
    // `facturas` se guardan como vienen del documento y los de
    // `proveedores` normalizados: se normalizan ambos lados para comparar.
    //
    // Vale como EMISOR o como RECEPTOR, y las dos puntas son legítimas: en
    // su factura de venta el proveedor emite, y en una compra relacionada
    // recibe. Lo que el chequeo impide es enganchar una factura entre dos
    // terceros, donde el proveedor no es parte.
    if (d.factura_id) {
      const { rows } = await query(
        `SELECT f.id FROM facturas f, proveedores p
          WHERE f.id = $1 AND p.id = $2
            AND p.rut IN (
              regexp_replace(upper(coalesce(f.rut_emisor, '')),   '[^0-9K]', '', 'g'),
              regexp_replace(upper(coalesce(f.rut_receptor, '')), '[^0-9K]', '', 'g')
            )`,
        [d.factura_id, req.user.proveedor_id]
      );
      if (!rows[0]) {
        return res.status(400).json({
          error: 'Tu empresa no aparece en esa factura, ni como emisora ni como receptora: '
            + 'no puede ser un documento de tu expediente.',
        });
      }
    }

    // El dato al que este documento respalda tiene que ser de ESTE
    // expediente. Sin el chequeo, un dato_id de otro expediente —incluso de
    // otra empresa— quedaría enganchado y su nivel de confianza subiría
    // apoyándose en un documento que no le corresponde.
    if (d.dato_id) {
      if (!UUID_RE.test(String(d.dato_id))) {
        return res.status(400).json({ error: 'Ese dato no existe en este expediente.' });
      }
      const { rows } = await query(
        `SELECT id FROM datos_trazables WHERE id = $1 AND expediente_id = $2`,
        [d.dato_id, req.params.id]
      );
      if (!rows[0]) return res.status(400).json({ error: 'Ese dato no existe en este expediente.' });
    }

    // El emisor se valida igual que el RUT del cliente: un dígito
    // verificador malo hace que el documento nunca cruce con nada.
    const emisor = rutDe(d.emisor_rut);
    if (!emisor.ok) return res.status(400).json({ error: emisor.error });

    try {
      const { rows } = await query(
        `INSERT INTO expediente_documentos
           (expediente_id, rol, asociacion, porcentaje, base_prorrateo, factura_id,
            dte_proveedor_id, descripcion, emisor_rut, tipo_dte, folio, fecha, monto,
            dato_id, cantidad, unidad)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING ${CAMPOS_DOCUMENTO}`,
        [req.params.id, d.rol, d.asociacion, d.porcentaje, texto(d.base_prorrateo, 200),
          d.factura_id || null, d.dte_proveedor_id || null, texto(d.descripcion, 300),
          emisor.valor ?? null,
          d.tipo_dte,
          texto(d.folio, 40),
          /^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha || '')) ? d.fecha : null,
          d.monto,
          d.dato_id || null, d.cantidad, texto(d.unidad, 20)]
      );
      const recargado = await cargarExpediente(req.params.id, req.user.proveedor_id);
      res.status(201).json({
        documento: rows[0],
        resumen: resumenExpediente(recargado.expediente, recargado.documentos),
      });
    } catch (err) {
      // Los tres índices únicos de la migración 105, con su mensaje propio:
      // un 23505 crudo le diría al proveedor "duplicate key value violates
      // unique constraint" y no qué hacer.
      if (err?.code === '23505') {
        if (String(err.constraint || '').includes('venta_principal')) {
          return res.status(409).json({
            error: 'Este expediente ya tiene su factura de venta. Un expediente = una venta: '
              + 'abre otro expediente para la otra factura.',
          });
        }
        return res.status(409).json({ error: 'Ese documento ya está en este expediente.' });
      }
      throw err;
    }
  } catch (err) { next(err); }
});

// ---------- DELETE /:id/documentos/:docId — soltar un documento ----------
// Se puede borrar: un expediente en armado NO es una cadena de hash, es la
// carpeta que el proveedor está ordenando. La inmutabilidad vive en los
// DTE que apunta (facturas.hash_cadena), no acá — y por eso soltar el
// vínculo nunca toca el documento.
router.delete('/:id/documentos/:docId', requireNivelOperador, async (req, res, next) => {
  try {
    const cargado = await cargarExpediente(req.params.id, req.user.proveedor_id);
    if (!cargado) return res.status(404).json({ error: 'Expediente no encontrado.' });

    const { rowCount } = await query(
      `DELETE FROM expediente_documentos WHERE id = $1 AND expediente_id = $2`,
      [req.params.docId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Documento no encontrado en el expediente.' });

    await logActividad({
      usuarioId: req.user.sub, accion: 'expediente_documento_soltar', entidad: 'expediente',
      entidadId: req.params.id, detalle: { documento_id: req.params.docId }, ip: req.ip,
    });
    const recargado = await cargarExpediente(req.params.id, req.user.proveedor_id);
    res.json({ resumen: resumenExpediente(recargado.expediente, recargado.documentos) });
  } catch (err) { next(err); }
});

// ---------- DELETE /:id — botar un expediente vacío ----------
// Solo en 'borrador' y sin documentos: un expediente que ya reunió
// evidencia se cierra, no se borra.
router.delete('/:id', requireNivelOperador, async (req, res, next) => {
  try {
    const cargado = await cargarExpediente(req.params.id, req.user.proveedor_id);
    if (!cargado) return res.status(404).json({ error: 'Expediente no encontrado.' });
    if (cargado.documentos.length) {
      return res.status(409).json({
        error: 'Este expediente ya tiene documentos. Ciérralo en vez de borrarlo.',
      });
    }
    await query(`DELETE FROM expedientes WHERE id = $1 AND proveedor_id = $2`,
      [req.params.id, req.user.proveedor_id]);
    await logActividad({
      usuarioId: req.user.sub, accion: 'expediente_borrar', entidad: 'expediente',
      entidadId: req.params.id, detalle: {}, ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
