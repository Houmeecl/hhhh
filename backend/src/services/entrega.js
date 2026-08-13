import crypto from 'crypto';
import { query } from '../lib/db.js';
import { cifrar, descifrar, cifradoDisponible } from './cripto.js';

// ============================================================
// ENTREGA CIFRADA DEL ACTIVO.
//
// El activo de sicr3p es la contabilidad sellada, y hasta ahora viajaba en
// claro: el informe salía como PDF adjunto en un correo. Un adjunto de
// correo cruza servidores que no controlamos, se queda en la bandeja del
// destinatario para siempre y se reenvía con dos clics. Sellar el cálculo
// y después mandarlo desnudo es sellar la puerta y dejar la ventana abierta.
//
// Este módulo hace dos cosas y ninguna más:
//
//  1. LA CLAVE POR EMPRESA. Cada empresa tiene una contraseña de informe,
//     estable en el tiempo, guardada CIFRADA en reposo con la misma llave
//     maestra que ya protege las credenciales del SII (services/cripto.js,
//     AES-256-GCM, llave solo en env). Si se filtra la base, las claves no
//     sirven de nada.
//
//  2. EL ACUSE DE LO ENTREGADO. Se anota el hash SHA-256 del archivo
//     CIFRADO que salió. Eso permite responder con precisión la pregunta
//     que un activo tiene que poder responder: "¿qué archivo exacto
//     recibió esta empresa en julio?". No es la cadena de integridad —no
//     se encadena, no se sella— es el recibo de la entrega.
//
// LO QUE NO HACE, Y HAY QUE SABERLO: un PDF con contraseña protege el
// archivo, no el canal. La contraseña NUNCA viaja en el mismo correo que
// el PDF; se entrega una sola vez desde el panel. Y el cifrado del PDF
// resiste a quien tenga el archivo, no a quien tenga la contraseña.
// ============================================================

// Alfabeto sin caracteres ambiguos: esta clave se dicta por teléfono y se
// copia a mano en el diálogo de Acrobat. Mismo criterio que la contraseña
// temporal de cuentas.js — 0/O y 1/l/I fuera.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Contraseña de informe: 16 caracteres, ~92 bits. */
export function generarClaveInforme(largo = 16) {
  const bytes = crypto.randomBytes(largo);
  let out = '';
  for (let i = 0; i < largo; i++) out += ALFABETO[bytes[i] % ALFABETO.length];
  return out;
}

/**
 * Opciones de pdfkit para emitir el documento cifrado con AES-256.
 *
 * `pdfVersion: '1.7ext3'` NO es decorativo: es lo que hace que pdfkit use
 * AESV3 (256 bits). Sin esa línea cae a AESV2 (128) o a RC4 según versión,
 * y el archivo queda con un cifrado que hoy no se considera suficiente.
 *
 * `ownerPassword` distinta de la del lector: quien tiene la clave puede
 * ABRIR e imprimir el informe, no reeditarlo. Es una barrera débil por
 * diseño del formato PDF —cualquiera que pueda abrirlo puede copiar el
 * contenido— pero deja explícito qué se autorizó.
 *
 * Sin clave devuelve `{}`: el llamador no tiene que ramificar.
 */
export function opcionesCifrado(clave) {
  if (!clave) return {};
  return {
    userPassword: String(clave),
    ownerPassword: `${clave}:propietario`,
    pdfVersion: '1.7ext3',
    permissions: { printing: 'highResolution', modifying: false, copying: false },
  };
}

/** ¿El PDF salió cifrado de verdad? Se usa en los tests y en el acuse. */
export function pdfEstaCifrado(buffer) {
  return Buffer.isBuffer(buffer) && buffer.includes(Buffer.from('/Encrypt'));
}

export const hashArchivo = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// ---------- la clave de cada proveedor ----------

/**
 * Devuelve la clave de informe de un proveedor, creándola la primera vez.
 *
 * Idempotente y con bloqueo optimista: dos envíos simultáneos del mismo
 * mes no pueden dejar dos claves distintas —el `WHERE clave_informe IS
 * NULL` hace que solo el primero escriba, y el segundo relee la que quedó.
 *
 * Devuelve `null` si el cifrado no está disponible (falta la llave maestra
 * en producción). El llamador decide: mejor mandar el informe sin cifrar y
 * decirlo, que no mandarlo — pero esa decisión no se toma acá.
 */
export async function claveDeProveedor(proveedorId) {
  if (!cifradoDisponible()) return null;

  const { rows } = await query(
    `SELECT clave_informe FROM proveedores WHERE id = $1`, [proveedorId]
  );
  if (!rows[0]) return null;
  if (rows[0].clave_informe) {
    try {
      return descifrar(rows[0].clave_informe);
    } catch (e) {
      // La llave maestra cambió y lo guardado ya no se puede leer. Se
      // avisa fuerte y se devuelve null: generar una clave nueva en
      // silencio dejaría al cliente sin poder abrir sus informes viejos.
      console.error(`[entrega] la clave de informe del proveedor ${proveedorId} no se puede descifrar: ${e.message}`);
      return null;
    }
  }

  const nueva = generarClaveInforme();
  const { rows: act } = await query(
    `UPDATE proveedores SET clave_informe = $2
      WHERE id = $1 AND clave_informe IS NULL
      RETURNING clave_informe`,
    [proveedorId, cifrar(nueva)]
  );
  if (act[0]) return nueva;

  // Otro proceso la creó entremedio: se lee la suya.
  const { rows: otra } = await query(`SELECT clave_informe FROM proveedores WHERE id = $1`, [proveedorId]);
  return otra[0]?.clave_informe ? descifrar(otra[0].clave_informe) : null;
}

/** Rota la clave. Los informes YA entregados siguen abriéndose con la anterior. */
export async function rotarClaveProveedor(proveedorId) {
  if (!cifradoDisponible()) return null;
  const nueva = generarClaveInforme();
  const { rows } = await query(
    `UPDATE proveedores SET clave_informe = $2 WHERE id = $1 RETURNING id`,
    [proveedorId, cifrar(nueva)]
  );
  return rows[0] ? nueva : null;
}

// ---------- el acuse ----------

export const TIPOS_ENTREGA = ['informe_sesion', 'informe_mensual', 'comprobante_transporte', 'carpeta_mandante'];

/**
 * Anota qué archivo se entregó, a quién y cuándo. No lanza: perder el
 * acuse no puede impedir la entrega que ya ocurrió.
 *
 * Se guarda el hash del archivo TAL COMO SALIÓ (cifrado si iba cifrado):
 * es lo que permite comparar bit a bit contra lo que el cliente diga que
 * recibió. Guardar el hash del PDF en claro no probaría nada sobre el
 * archivo que efectivamente viajó.
 */
export async function registrarEntrega({
  tipo, proveedorId = null, destinatario, archivo, cifrado, periodo = null, referencia = null,
}) {
  try {
    await query(
      `INSERT INTO entregas (tipo, proveedor_id, destinatario_email, hash_archivo, bytes, cifrado, periodo, referencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tipo, proveedorId, destinatario, hashArchivo(archivo), archivo.length,
       Boolean(cifrado), periodo, referencia]
    );
  } catch (e) {
    console.error('[entrega] no se pudo registrar la entrega:', e.message);
  }
}
