import crypto from 'crypto';
import { config } from '../config.js';
import { query, withTx } from '../lib/db.js';
import { credencialesEmail, linkPagoEmail } from './mailer.js';
import { enviarYRegistrar, correosDadosDeBaja } from './correoLog.js';
import { generarTokenPago, pasarelaActiva } from './pagos.js';
import { primerEmail } from './tabla.js';
import { rutValido } from './dte.js';

// ============================================================
// El flujo comercial completo: lista → cobro → pago → acceso.
//
// LA PIEZA CRÍTICA es `entregarAcceso`. Corre desde un webhook público,
// puede llegar repetida (Flow reintenta si no recibe 200 a tiempo, y un
// admin puede confirmar a mano un pago que el webhook ya confirmó) y del
// otro lado hay dinero. Tiene que ser IDEMPOTENTE de verdad: dos avisos
// del mismo pago entregan UN código, no dos.
//
// Cómo se logra: el bloqueo de fila (`SELECT ... FOR UPDATE`) más el
// estado del propio cobro. Si ya está 'entregado', se devuelve el código
// que ya existe y no se emite otro. Mismo patrón con el que este repo ya
// consume créditos en routes/public.js.
//
// Y una separación que importa: el código se emite DENTRO de la
// transacción, el correo se manda FUERA. Si el correo falla, el comprador
// igual tiene su código emitido y el admin lo reenvía con un botón, sin
// volver a cobrar ni emitir uno nuevo.
// ============================================================

const AREA = 'Comercial';

// ---------- importar la lista ----------

const texto = (v, max) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
};

// Tope de lo que se puede cobrar por una fila importada. No es una regla
// de negocio sino una barrera contra el dedo equivocado: si el admin
// mapea "Monto" a la columna del teléfono, sin esto se intentaba cobrar
// $56.229.694.695 — un número que además no cabe en el INT de la columna
// y reventaba el INSERT a mitad de la importación, dejando parte de la
// lista adentro y parte afuera. Ante un valor absurdo se usa el precio de
// la campaña, que es el que el admin sí revisó.
export const MONTO_MAX_CLP = 50_000_000;

export function montoDeCelda(celda, montoDefecto) {
  const n = Number(String(celda ?? '').replace(/[^\d]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > MONTO_MAX_CLP) return montoDefecto;
  return n;
}

/**
 * Convierte las filas crudas de la planilla en destinatarios listos para
 * insertar. Devuelve `{ admitidos, omitidos, duplicados }`.
 *
 * NO escribe nada: la vista previa y la importación llaman a esto mismo,
 * así que lo que el admin ve antes de confirmar es exactamente lo que se
 * va a guardar, y no una aproximación.
 *
 * Lo que se descarta y por qué queda dicho fila por fila — una lista real
 * trae miles de filas y "se importaron 4.831 de 4.967" sin explicación no
 * le sirve a nadie para decidir si está bien.
 */
export function prepararDestinatarios(filas, mapeo, { desde = 0, montoDefecto = null } = {}) {
  const admitidos = [];
  const omitidos = [];
  const vistos = new Set();
  let duplicados = 0;

  const col = (f, campo) => (mapeo[campo] == null ? null : f[mapeo[campo]]);

  for (let i = desde; i < (filas?.length || 0); i++) {
    const f = filas[i] || [];
    const fila = i + 1; // como se numera en Excel, para que el admin la encuentre
    if (!f.some((c) => String(c ?? '').trim())) continue; // fila vacía: ni se menciona

    const email = primerEmail(col(f, 'email'));
    if (!email) {
      omitidos.push({ fila, motivo: 'sin correo válido', dato: texto(col(f, 'empresa'), 80) });
      continue;
    }
    if (vistos.has(email)) { duplicados++; continue; }
    vistos.add(email);

    // El RUT se acepta solo si es un RUT de verdad. Una lista de ferias
    // trae teléfonos y códigos internos en esa columna; guardarlos como
    // RUT contamina la búsqueda por RUT de todo el sistema.
    const rutCrudo = texto(col(f, 'rut'), 20);
    const monto = montoDeCelda(col(f, 'monto'), montoDefecto);

    admitidos.push({
      fila,
      empresa: texto(col(f, 'empresa'), 200),
      rut: rutCrudo && rutValido(rutCrudo) ? rutCrudo : null,
      contacto: texto(col(f, 'contacto'), 120),
      email,
      monto_clp: monto,
    });
  }
  return { admitidos, omitidos, duplicados };
}

/**
 * Inserta los destinatarios de una campaña. Los que ya estaban se
 * ignoran (índice único por campaña+correo): reimportar la misma
 * planilla —que va a pasar— no duplica cobros ni reinicia estados.
 */
export async function importarDestinatarios({ campanaId, destinatarios, montoCampana }) {
  let insertados = 0;
  let yaEstaban = 0;
  for (const d of destinatarios) {
    const { rowCount } = await query(
      `INSERT INTO cobros (campana_id, empresa, rut, contacto, email, monto_clp, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING`,
      [campanaId, d.empresa, d.rut, d.contacto, d.email,
       d.monto_clp || montoCampana, generarTokenPago()]
    );
    if (rowCount) insertados++; else yaEstaban++;
  }
  return { insertados, ya_estaban: yaEstaban };
}

// ---------- enviar el link ----------

export const urlDePago = (token) => `${config.publicAppUrl}/pagar/${token}`;
// Dos direcciones para lo MISMO, y las dos hacen falta:
//  · la del sitio, para el enlace que una persona pincha y ve confirmado;
//  · la de la API, para el POST servidor-a-servidor que hace el cliente
//    de correo con la baja en un clic (RFC 8058) — ahí no corre nada de
//    JavaScript, así que apuntar a la página no daría de baja a nadie.
export const urlDeBaja = (token) => `${config.publicAppUrl}/pagar/${token}/baja`;
export const urlDeBajaApi = (token) => `${config.publicApiUrl}/api/pagar/${token}/baja`;

/**
 * Manda el correo con el link de pago de UN cobro y lo marca 'enviado'.
 *
 * El estado se marca aunque el correo falle, y por eso el resultado dice
 * `correo_ok`: lo contrario haría que un reintento masivo se quedara
 * pegado reintentando la misma dirección muerta en cada tanda.
 */
export async function enviarLinkPago(cobro, campana) {
  const plantilla = linkPagoEmail({
    empresa: cobro.empresa,
    contacto: cobro.contacto,
    montoClp: cobro.monto_clp,
    creditos: campana.creditos,
    campana: campana.nombre,
    link: urlDePago(cobro.token),
    bajaUrl: urlDeBaja(cobro.token),
    bajaPostUrl: urlDeBajaApi(cobro.token),
  });
  const r = await enviarYRegistrar({
    para: cobro.email, area: AREA, tipo: 'link_pago', referencia: cobro.id, plantilla,
  });
  await query(
    `UPDATE cobros SET estado = 'enviado', enviado_at = now()
      WHERE id = $1 AND estado = 'pendiente'`,
    [cobro.id]
  );
  return { id: cobro.id, email: cobro.email, correo_ok: r.ok, error: r.error };
}

/**
 * Envía una tanda de cobros pendientes, saltando a quien pidió no
 * recibir más correos.
 *
 * El tope por tanda no es una limitación técnica sino una decisión: la
 * lista real tiene miles de direcciones y soltarlas de una vez es la
 * forma más rápida de que el proveedor corte el envío y de que el
 * dominio quede marcado — el mismo dominio del que salen los correos de
 * activación y recuperación de clave de toda la plataforma.
 */
export async function enviarTanda({ campanaId, limite }) {
  const { rows: cam } = await query(`SELECT * FROM campanas_cobro WHERE id = $1`, [campanaId]);
  const campana = cam[0];
  if (!campana) return { error: 'Campaña no encontrada.' };
  if (!campana.activa) return { error: 'La campaña está pausada.' };

  const tope = Math.min(Math.max(1, Number(limite) || config.pagos.loteMax), config.pagos.loteMax);
  const { rows: pendientes } = await query(
    `SELECT * FROM cobros WHERE campana_id = $1 AND estado = 'pendiente'
      ORDER BY created_at LIMIT $2`,
    [campanaId, tope]
  );

  const bajas = await correosDadosDeBaja(pendientes.map((c) => c.email));
  const enviados = [];
  const fallidos = [];
  let saltados = 0;

  for (const c of pendientes) {
    if (bajas.has(c.email.toLowerCase())) {
      // Se anula, no se deja pendiente: si no, la próxima tanda vuelve a
      // encontrarlo y se lo salta otra vez, para siempre.
      await query(
        `UPDATE cobros SET estado = 'anulado', notas = 'El destinatario pidió no recibir más correos.'
          WHERE id = $1`, [c.id]
      );
      saltados++;
      continue;
    }
    const r = await enviarLinkPago(c, campana);
    (r.correo_ok ? enviados : fallidos).push(r);
  }

  const { rows: resto } = await query(
    `SELECT count(*)::int AS n FROM cobros WHERE campana_id = $1 AND estado = 'pendiente'`,
    [campanaId]
  );
  return {
    enviados: enviados.length,
    fallidos,
    dados_de_baja: saltados,
    quedan_pendientes: resto[0].n,
  };
}

// ---------- cobrar y entregar ----------

// 6 bytes (48 bits), no los 3 que usa el alta manual del panel.
//
// Cuando un código era una cortesía repartida a mano, 24 bits daba lo
// mismo: nadie iba a rifar 16 millones de intentos por una prueba
// gratis. Ahora cada acierto vale lo que cobra la campaña, y el canje es
// PÚBLICO y sin sesión (GET /api/codigos/:codigo). Con unos cientos de
// códigos vivos, 24 bits deja una probabilidad por intento del orden de
// 1 en 50.000: se barre desde varias IP en horas. Con 48 bits la misma
// búsqueda es del orden de 1 en mil millones.
//
// Se agrupa de a 4 para poder dictarlo por teléfono sin perder la cuenta.
const CODIGO_BYTES = 6;

function nuevoCodigo() {
  const hex = crypto.randomBytes(CODIGO_BYTES).toString('hex').toUpperCase();
  return `SICR3P-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/**
 * Marca el cobro como pagado y entrega el acceso. Idempotente.
 *
 * Devuelve `{ ya_estaba, cobro, codigo, correo }`. `ya_estaba: true`
 * significa que este pago ya se había procesado — no es un error, es el
 * caso normal cuando Flow reintenta el aviso.
 */
export async function registrarPagoYEntregar({ cobroId, pasarela, ref = null, montoPagado = null }) {
  const resultado = await withTx(async (client) => {
    const { rows } = await client.query(
      `SELECT c.*, k.nombre AS campana_nombre, k.creditos
         FROM cobros c JOIN campanas_cobro k ON k.id = c.campana_id
        WHERE c.id = $1 FOR UPDATE OF c`,
      [cobroId]
    );
    const cobro = rows[0];
    if (!cobro) return { error: 'Cobro no encontrado.' };
    if (cobro.estado === 'anulado') return { error: 'Este cobro está anulado.' };

    // Ya se emitió el código: este pago ya se procesó. Se pregunta por
    // `codigo_id` y NO por el estado, porque un cobro puede quedarse en
    // 'pagado' (código emitido, correo caído) y ahí también sería un
    // reproceso. Este es el camino del segundo aviso de Flow y tiene que
    // ser inofensivo.
    if (cobro.codigo_id) {
      const { rows: k } = await client.query(`SELECT * FROM codigos_acceso WHERE id = $1`, [cobro.codigo_id]);
      // Un pago DISTINTO sobre un cobro ya pagado no es un reintento: es
      // un cobro duplicado, y del otro lado hay una devolución pendiente.
      // Antes se descartaba en silencio y solo quedaba rastro en el panel
      // de la pasarela.
      const otroPago = ref && cobro.pasarela_ref && ref !== cobro.pasarela_ref;
      if (otroPago) {
        await client.query(
          `UPDATE cobros SET notas = COALESCE(notas || ' | ', '') ||
             'PAGO DUPLICADO: llegó la referencia ' || $2 || ' y ya estaba pagado con ' || $3 ||
             '. Revisar si corresponde devolver.'
            WHERE id = $1`,
          [cobro.id, ref, cobro.pasarela_ref]
        );
      }
      return { ya_estaba: true, duplicado: otroPago, cobro, codigo: k[0] };
    }

    // Un pago por un monto distinto al cobrado no se entrega solo: puede
    // ser un abono, un error de la pasarela o un intento de pagar $1 por
    // un acceso de $50.000. Queda anotado y lo resuelve una persona.
    if (montoPagado != null && Math.round(montoPagado) !== Number(cobro.monto_clp)) {
      await client.query(
        `UPDATE cobros SET pasarela = $2, pasarela_ref = $3,
                notas = $4 WHERE id = $1`,
        [cobro.id, pasarela, ref,
         `Pago por $${Math.round(montoPagado)} y el cobro era por $${cobro.monto_clp}. Revisar a mano.`]
      );
      return { error: 'El monto pagado no coincide con el cobrado.', descalce: true };
    }

    // Reintento del formato hasta encontrar uno libre. Con 3 bytes hay
    // 16 millones de combinaciones; el choque es teórico, pero el índice
    // único lo haría fallar y no vale la pena perder un pago por eso.
    let codigo = null;
    for (let intento = 0; intento < 5 && !codigo; intento++) {
      const { rows: k } = await client.query(
        `INSERT INTO codigos_acceso (codigo, creditos, empresa, email)
         VALUES ($1,$2,$3,$4) ON CONFLICT (codigo) DO NOTHING RETURNING *`,
        [nuevoCodigo(), cobro.creditos, cobro.empresa, cobro.email]
      );
      codigo = k[0] || null;
    }
    if (!codigo) return { error: 'No se pudo emitir el código de acceso.' };

    // Queda en 'pagado', NO en 'entregado': dentro de la transacción lo
    // único cierto es que el dinero entró y el código existe. "Entregado"
    // se gana cuando el correo con la clave sale de verdad, unas líneas
    // más abajo. Sin esta distinción, un cobro cuyo correo rebotó era
    // indistinguible de uno atendido y el comprador quedaba pagando por
    // nada sin que nadie se enterara.
    const { rows: act } = await client.query(
      `UPDATE cobros SET estado = 'pagado', pasarela = $2, pasarela_ref = $3,
              codigo_id = $4, pagado_at = COALESCE(pagado_at, now())
        WHERE id = $1 RETURNING *`,
      [cobro.id, pasarela, ref, codigo.id]
    );
    return { ya_estaba: false, cobro: { ...act[0], creditos: cobro.creditos }, codigo };
  });

  if (resultado.error || resultado.ya_estaba) return resultado;

  // Fuera de la transacción: el correo puede tardar segundos y no puede
  // mantener abierta una fila con dinero asociado.
  const correo = await enviarCredenciales(resultado.cobro, resultado.codigo);
  return { ...resultado, correo };
}

/**
 * Marca 'entregado' cuando el correo con la clave salió. Es el único
 * lugar que escribe ese estado, y lo llaman los dos caminos: la entrega
 * automática y el reenvío manual desde el panel.
 */
async function marcarEntregado(cobroId) {
  await query(
    `UPDATE cobros SET estado = 'entregado', entregado_at = now()
      WHERE id = $1 AND estado = 'pagado'`,
    [cobroId]
  );
}

/**
 * Manda la clave. Reutilizable tal cual para el botón "reenviar": no
 * emite nada, solo vuelve a enviar lo que ya existe.
 */
export async function enviarCredenciales(cobro, codigo) {
  const plantilla = credencialesEmail({
    empresa: cobro.empresa,
    codigo: codigo.codigo,
    creditos: codigo.creditos,
    // /prueba es la pantalla que canjea un código (Prueba.jsx). Con el
    // código en la URL entra sola: quien acaba de pagar no debería tener
    // que copiar nada a mano para empezar.
    //
    // VA EN EL FRAGMENTO (#) Y NO EN LA QUERY (?) A PROPÓSITO. El
    // fragmento NUNCA se manda al servidor: no aparece en el access log
    // de nginx, no viaja en la cabecera Referer hacia terceros y no queda
    // en los registros de ningún proxy intermedio. Con `?codigo=` la
    // clave recién vendida quedaba escrita en texto plano en los logs del
    // propio servidor — justo lo que correoLog.js se prohíbe hacer con la
    // bitácora de correos.
    link: `${config.publicAppUrl}/prueba#codigo=${encodeURIComponent(codigo.codigo)}`,
  });
  // La clave va SIEMPRE al correo registrado en el cobro, nunca al que
  // haya usado quien pagó: el link de pago se puede reenviar entre
  // personas, y el acceso tiene que llegar a quien se le vendió.
  const r = await enviarYRegistrar({
    para: cobro.email, area: AREA, tipo: 'credenciales', referencia: cobro.id, plantilla,
  });
  // Solo si salió. Si falló, el cobro se queda en 'pagado' y el panel lo
  // muestra como "pagado · falta la clave" con su botón de reenvío.
  if (r.ok) await marcarEntregado(cobro.id);
  return r;
}

// ---------- lo que ve la página pública ----------

/** Datos mínimos del cobro para la página de pago. Nunca expone el código. */
export function vistaPublica(cobro, campana) {
  const pasarela = pasarelaActiva();
  return {
    empresa: cobro.empresa,
    contacto: cobro.contacto,
    monto_clp: cobro.monto_clp,
    creditos: campana.creditos,
    campana: campana.nombre,
    descripcion: campana.descripcion,
    // 'entregado' se le muestra como 'pagado': para quien mira, el
    // detalle de si el correo salió no es su problema.
    estado: cobro.estado === 'entregado' ? 'pagado' : cobro.estado,
    pasarela,
    transferencia: pasarela === 'manual' ? config.pagos.transferencia : undefined,
  };
}
