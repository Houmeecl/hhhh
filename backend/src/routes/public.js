import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { query, withTx } from '../lib/db.js';
import { simpleApi } from '../services/simpleApi.js';
import { generateReport, generateLabel } from '../services/pdf.js';
import { qrBuffer } from '../services/qr.js';
import { sendMail, reporteEmail } from '../services/mailer.js';
import { cargarCuentas, registrarMovimientos } from '../services/capitalNatural.js';
import { parseDte } from '../services/dte.js';
import { bigquery } from '../services/bigquery.js';
import { cargarCategorias, calcularFactura } from '../services/motorPropio.js';
import { normalizarRut, dispararWebhook } from '../services/mandante.js';
import { hashDocumento, hashCadena, eslabonValido } from '../services/cadenaHash.js';
import { validarComponentes, calcularReciclabilidad } from '../services/rep.js';

const router = express.Router();

// Almacenamiento en memoria; solo guardamos el nombre original (no el binario).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: config.maxFilesPerSession },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|xml|jpe?g|png|heic)$/i.test(file.originalname);
    cb(ok ? null : new Error('Formato no permitido'), ok);
  },
});

// Carga completa de una tabla de ítems para una lista de facturas.
async function hydrateFacturas(sesionId) {
  const { rows: facturas } = await query(
    `SELECT * FROM facturas WHERE sesion_id = $1 ORDER BY created_at`,
    [sesionId]
  );
  for (const f of facturas) {
    const { rows: items } = await query(
      `SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = $1`,
      [f.id]
    );
    f.items = items;
  }
  return facturas;
}

// Envuelve multer para devolver el mensaje amigable del límite duro de la demo.
function uploadArchivos(req, res, next) {
  upload.array('archivos', config.maxFilesPerSession)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Puedes cargar hasta 5 facturas por envío. Contáctanos para más.' });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Cada archivo debe pesar menos de 15 MB.' });
      }
      return res.status(400).json({ error: 'No se pudo procesar la carga de archivos.' });
    }
    if (err) return res.status(400).json({ error: err.message || 'Formato no permitido.' });
    next();
  });
}

// ---------- GET /api/codigos/:codigo — estado de un código de acceso ----------
router.get('/codigos/:codigo', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT codigo, creditos, creditos_usados, activo, empresa FROM codigos_acceso
       WHERE upper(codigo) = upper($1)`,
      [String(req.params.codigo).trim()]
    );
    const c = rows[0];
    if (!c || !c.activo) return res.status(404).json({ error: 'Código inválido o inactivo.' });
    res.json({
      valido: true,
      codigo: c.codigo,
      empresa: c.empresa,
      creditos_restantes: Math.max(0, c.creditos - c.creditos_usados),
    });
  } catch (err) { next(err); }
});

// ---------- POST /api/sesiones — procesa hasta 5 facturas ----------
router.post('/sesiones', uploadArchivos, async (req, res, next) => {
  try {
    const { rut, empresa, email, codigo } = req.body;
    const files = req.files || [];

    if (!rut || !empresa || !email) {
      return res.status(400).json({ error: 'Faltan datos: RUT, empresa y email son obligatorios.' });
    }
    if (files.length === 0) {
      return res.status(400).json({ error: 'Debes subir al menos una factura.' });
    }
    // Límite duro por envío.
    if (files.length > config.maxFilesPerSession) {
      return res.status(400).json({
        error: 'Puedes cargar hasta 5 facturas por envío. Contáctanos para más.',
      });
    }

    const result = await withTx(async (client) => {
      // Código de acceso con créditos (1 crédito = 1 factura procesada).
      // Se valida y consume DENTRO de la transacción (con lock de fila).
      if (codigo) {
        const { rows: cRows } = await client.query(
          `SELECT * FROM codigos_acceso WHERE upper(codigo) = upper($1) FOR UPDATE`,
          [String(codigo).trim()]
        );
        const c = cRows[0];
        if (!c || !c.activo) {
          const e = new Error('Código inválido o inactivo.'); e.status = 400; throw e;
        }
        const restantes = c.creditos - c.creditos_usados;
        if (restantes < files.length) {
          const e = new Error(`Tu código tiene ${restantes} crédito${restantes === 1 ? '' : 's'} y estás subiendo ${files.length} facturas.`);
          e.status = 400; throw e;
        }
        await client.query(
          `UPDATE codigos_acceso SET creditos_usados = creditos_usados + $2, ultimo_uso = now() WHERE id = $1`,
          [c.id, files.length]
        );
      }

      const { rows: sRows } = await client.query(
        `INSERT INTO sesiones (rut_cliente, nombre_cliente, email_cliente)
         VALUES ($1,$2,$3) RETURNING *`,
        [rut, empresa, email]
      );
      const sesion = sRows[0];

      // Plan de cuentas de Capital Natural (una sola carga por sesión).
      const cuentasNaturales = await cargarCuentas((sql) => client.query(sql));
      // Categorías del motor propio (una sola carga por sesión).
      const categoriasMotor = await cargarCategorias((sql) => client.query(sql));

      // Cadena de hash: se bloquea la fila de estado (FOR UPDATE) para toda
      // la transacción, serializando sesiones concurrentes — cada factura
      // se encadena a la anterior, incluidas las de esta misma sesión.
      const { rows: cadenaRows } = await client.query(
        `SELECT ultimo_hash, n_eslabones FROM cadena_estado WHERE id = 1 FOR UPDATE`
      );
      let hashAnterior = cadenaRows[0].ultimo_hash;
      let eslabon = Number(cadenaRows[0].n_eslabones);

      let totalSesion = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Si el archivo es un DTE XML, se extraen los datos reales del
        // documento (folio, RUT, ítems con cantidad/unidad/monto reales).
        let dte = null;
        if (/\.xml$/i.test(file.originalname)) {
          dte = parseDte(file.buffer.toString('utf8'));
        }

        let analysis;
        let motor;
        if (dte && dte.items?.length) {
          // Motor propio: cálculo real a partir de los datos del DTE, sin
          // depender del motor externo.
          const calc = calcularFactura(dte.items, categoriasMotor);
          analysis = {
            invoice_id_simple: null,
            numero_venta: dte.folio ? `F-${dte.folio}` : null,
            rut_emisor: dte.rut_emisor || null,
            rut_receptor: dte.rut_receptor || rut,
            total_co2e: calc.total_co2e,
            categoria: calc.categoria,
            items: calc.items,
          };
          motor = 'propio';
        } else {
          // Sin datos reales extraíbles (PDF/JPG/PNG/HEIC o XML no parseable): motor externo.
          analysis = await simpleApi.analyzeInvoice({
            sesionId: sesion.id,
            filename: file.originalname,
            index: i,
            rutReceptor: rut,
            client,
          });
          if (dte) {
            if (dte.folio) analysis.numero_venta = `F-${dte.folio}`;
            if (dte.rut_emisor) analysis.rut_emisor = dte.rut_emisor;
            if (dte.rut_receptor) analysis.rut_receptor = dte.rut_receptor;
          }
          motor = 'externo';
        }
        totalSesion += Number(analysis.total_co2e || 0);

        const hDoc = hashDocumento({
          numero_venta: analysis.numero_venta,
          rut_emisor: analysis.rut_emisor,
          rut_receptor: analysis.rut_receptor,
          total_co2e: analysis.total_co2e,
          categoria: analysis.categoria,
          archivo_original: file.originalname,
        });
        const hCad = hashCadena(hashAnterior, hDoc);
        eslabon += 1;

        const { rows: fRows } = await client.query(
          `INSERT INTO facturas
             (sesion_id, invoice_id_simple, numero_venta, archivo_original,
              rut_emisor, rut_receptor, total_co2e, categoria, status, motor,
              hash_documento, hash_anterior, hash_cadena, eslabon)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'procesada',$9,$10,$11,$12,$13) RETURNING *`,
          [
            sesion.id,
            analysis.invoice_id_simple,
            analysis.numero_venta,
            file.originalname,
            analysis.rut_emisor,
            analysis.rut_receptor,
            analysis.total_co2e,
            analysis.categoria,
            motor,
            hDoc,
            hashAnterior,
            hCad,
            eslabon,
          ]
        );
        hashAnterior = hCad;
        const factura = fRows[0];
        for (const it of analysis.items) {
          await client.query(
            `INSERT INTO line_items (factura_id, descripcion, cantidad, co2e, porcentaje_total)
             VALUES ($1,$2,$3,$4,$5)`,
            [factura.id, it.descripcion, it.cantidad, it.co2e, it.porcentaje_total]
          );
        }
        // Capital Natural: cargos automáticos en las cuentas ambientales activas.
        await registrarMovimientos({ client, factura, fecha: sesion.fecha, cuentas: cuentasNaturales });

        // Valorización: los DTE traen precio real por ítem → entradas de inventario.
        // El CO2e de la factura se reparte entre ítems según su monto.
        if (dte && dte.items?.length) {
          const totalMonto = dte.items.reduce((a, it) => a + (Number(it.monto) || 0), 0);
          for (const it of dte.items) {
            const cant = Number(it.cantidad) || 0;
            if (cant <= 0) continue;
            const monto = Number(it.monto) || 0;
            const co2eItem = totalMonto > 0 ? Number(analysis.total_co2e || 0) * (monto / totalMonto) : 0;
            await client.query(
              `INSERT INTO inventario_movimientos
                 (rut_cliente_norm, descripcion, fecha, tipo, cantidad, precio_unitario, co2e_unitario, factura_id, origen)
               VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),'entrada',$4,$5,$6,$7,'documento')`,
              [String(rut).replace(/[^0-9kK]/g, '').toUpperCase(), it.nombre, dte.fecha_emision || null,
               cant, Number(it.precio) || (cant > 0 ? monto / cant : 0),
               cant > 0 ? co2eItem / cant : 0, factura.id]
            );
          }
        }
      }

      await client.query(`UPDATE sesiones SET total_co2e = $1 WHERE id = $2`, [
        Math.round(totalSesion * 10000) / 10000,
        sesion.id,
      ]);
      sesion.total_co2e = Math.round(totalSesion * 10000) / 10000;

      // Cierra el avance de la cadena de hash con el último eslabón de esta sesión.
      await client.query(
        `UPDATE cadena_estado SET ultimo_hash = $1, n_eslabones = $2, updated_at = now() WHERE id = 1`,
        [hashAnterior, eslabon]
      );

      return sesion;
    });

    const facturas = await hydrateFacturas(result.id);
    res.status(201).json({ sesion: result, facturas });

    // Export al data warehouse (no bloqueante; apagado por defecto).
    bigquery.exportSesion({ sesion: result, facturas });

    // Envío del informe por correo (no bloqueante: nunca afecta la respuesta).
    (async () => {
      try {
        const pdf = await generateReport({ sesion: result, facturas });
        await sendMail({
          to: result.email_cliente,
          ...reporteEmail({ nombre: result.nombre_cliente, totalCo2e: result.total_co2e, nFacturas: facturas.length }),
          attachments: [{ filename: `sicr3p-informe-${result.id.slice(0, 8)}.pdf`, content: pdf }],
        });
      } catch (e) {
        console.warn('[correo] no se pudo enviar el informe:', e.message);
      }
    })();

    // Webhook al mandante cuyo RUT coincide con esta sesión (no bloqueante).
    (async () => {
      try {
        const rn = normalizarRut(result.rut_cliente);
        const { rows: mandantes } = await query(
          `SELECT id, webhook_url FROM mandantes
           WHERE activo = true AND webhook_url IS NOT NULL
             AND regexp_replace(rut, '[^0-9kK]', '', 'g') = $1`,
          [rn]
        );
        for (const m of mandantes) {
          const r = await dispararWebhook({
            url: m.webhook_url,
            payload: {
              evento: 'sesion.creada',
              sesion_id: result.id,
              rut_cliente: result.rut_cliente,
              nombre_cliente: result.nombre_cliente,
              total_co2e: result.total_co2e,
              n_facturas: facturas.length,
              fecha: result.fecha,
            },
          });
          if (!r.ok) console.warn(`[webhook] mandante ${m.id} no respondió ok:`, r.error || r.status);
        }
      } catch (e) {
        console.warn('[webhook] error al notificar mandantes:', e.message);
      }
    })();
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Puedes cargar hasta 5 facturas por envío. Contáctanos para más.' });
    }
    next(err);
  }
});

// ---------- POST /api/sesiones/:id/embalaje — declaración REP (Ley 20.920) ----------
// Persiste la pre-declaración de envases y embalajes del POS. El porcentaje
// y el nivel se recalculan SIEMPRE en el servidor (fórmula SICREP); nunca se
// aceptan valores calculados por el cliente. Una declaración por sesión:
// un nuevo POST reemplaza la anterior.
router.post('/sesiones/:id/embalaje', async (req, res, next) => {
  try {
    const { rows: sRows } = await query(`SELECT id, rut_cliente FROM sesiones WHERE id = $1`, [req.params.id]);
    if (!sRows[0]) return res.status(404).json({ error: 'Sesión no encontrada' });

    const componentes = req.body?.componentes;
    const val = validarComponentes(componentes);
    if (!val.ok) return res.status(400).json({ error: val.error });

    // Solo se persisten los campos declarados (nada extra del cliente).
    const limpios = componentes.map((c) => ({
      material: c.material,
      peso_gr: Number(c.peso_gr),
      cantidad: Number(c.cantidad),
      reciclable: c.reciclable,
    }));
    const calc = calcularReciclabilidad(limpios);

    const { rows } = await query(
      `INSERT INTO declaraciones_embalaje
         (sesion_id, componentes, peso_total_gr, peso_reciclable_gr, porcentaje, nivel)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6)
       ON CONFLICT (sesion_id) DO UPDATE SET
         componentes        = EXCLUDED.componentes,
         peso_total_gr      = EXCLUDED.peso_total_gr,
         peso_reciclable_gr = EXCLUDED.peso_reciclable_gr,
         porcentaje         = EXCLUDED.porcentaje,
         nivel              = EXCLUDED.nivel,
         created_at         = now()
       RETURNING *`,
      [
        req.params.id,
        JSON.stringify(limpios),
        calc.peso_total_gr,
        calc.peso_reciclable_gr,
        calc.porcentaje,
        calc.nivel,
      ]
    );
    res.status(201).json({ declaracion: rows[0] });
    // Export al warehouse (no bloqueante; cada versión queda como fila propia).
    bigquery.exportDeclaracionEmbalaje(rows[0], sRows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/sesiones/:id — resultados ----------
router.get('/sesiones/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Sesión no encontrada' });
    const facturas = await hydrateFacturas(req.params.id);
    const { rows: dRows } = await query(
      `SELECT * FROM declaraciones_embalaje WHERE sesion_id = $1`,
      [req.params.id]
    );
    res.json({ sesion: rows[0], facturas, declaracion_embalaje: dRows[0] || null });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/sesiones/:id/informe.pdf ----------
router.get('/sesiones/:id/informe.pdf', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Sesión no encontrada' });
    const facturas = await hydrateFacturas(req.params.id);
    const pdf = await generateReport({ sesion: rows[0], facturas });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-informe-${req.params.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/facturas/:id/etiqueta.pdf ----------
router.get('/facturas/:id/etiqueta.pdf', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM facturas WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
    const factura = rows[0];
    const { rows: items } = await query(
      `SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = $1`,
      [factura.id]
    );
    factura.items = items;
    const { rows: sRows } = await query(`SELECT * FROM sesiones WHERE id = $1`, [factura.sesion_id]);
    const pdf = await generateLabel({ sesion: sRows[0], factura });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicr3p-etiqueta-${factura.numero_venta || factura.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/facturas/:id/qr.png — QR de verificación (para previsualizar) ----------
router.get('/facturas/:id/qr.png', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT id FROM facturas WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
    const png = await qrBuffer(req.params.id);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/verificar/:id — verificación pública de trazabilidad ----------
router.get('/verificar/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM facturas WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Documento no encontrado' });
    const factura = rows[0];
    const { rows: items } = await query(
      `SELECT descripcion, cantidad, co2e, porcentaje_total FROM line_items WHERE factura_id = $1`,
      [factura.id]
    );
    const { rows: sRows } = await query(
      `SELECT nombre_cliente, rut_cliente, fecha FROM sesiones WHERE id = $1`,
      [factura.sesion_id]
    );
    // Declaración de embalaje REP (Ley 20.920) de la sesión, si existe.
    const { rows: eRows } = await query(
      `SELECT porcentaje, nivel, peso_total_gr,
              jsonb_array_length(componentes) AS n_componentes
       FROM declaraciones_embalaje WHERE sesion_id = $1`,
      [factura.sesion_id]
    );
    res.json({
      valido: true,
      factura: {
        id: factura.id,
        numero_venta: factura.numero_venta,
        categoria: factura.categoria,
        total_co2e: factura.total_co2e,
        status: factura.status,
        fecha: sRows[0]?.fecha,
      },
      cliente: {
        nombre: sRows[0]?.nombre_cliente,
        rut: sRows[0]?.rut_cliente,
      },
      cadena: factura.hash_cadena ? {
        eslabon: factura.eslabon,
        hash_documento: factura.hash_documento,
        hash_cadena: factura.hash_cadena,
        intacto: eslabonValido(factura),
      } : null,
      embalaje: eRows[0] ? {
        porcentaje: eRows[0].porcentaje,
        nivel: eRows[0].nivel,
        peso_total_gr: eRows[0].peso_total_gr,
        n_componentes: eRows[0].n_componentes,
      } : null,
      items,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
