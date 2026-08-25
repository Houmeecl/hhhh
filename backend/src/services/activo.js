import crypto from 'crypto';
import { semaforoExpediente } from './expediente.js';

// ============================================================
// Activos del piloto — lógica pura del adhesivo.
//
// QUÉ ES ESTO. Cada camioneta, grúa o equipo que entra al piloto lleva un
// adhesivo con un QR. Quien lo escanea llega al expediente público de ese
// activo, y el COLOR del adhesivo dice en qué estado está su evidencia.
//
// LA REGLA DEL COLOR, que es la misma del semáforo del expediente y no
// una nueva: verde solo si hay con qué comparar Y comparó; ámbar si el
// expediente está abierto y falta evidencia; gris si no hay línea base
// contra la cual medir.
//
// NO HAY ROJO, a propósito. Un adhesivo rojo en una camioneta se lee como
// «esta empresa está mal», y ese es un juicio que sicr3p no emite: el
// producto estructura evidencia, no califica a quien la aporta. El rojo
// que `semaforoExpediente` sí devuelve —cobertura 0 sobre un expediente
// que ya declaró qué esperaba— se muestra acá como ámbar: para el que va
// pasando significa lo mismo, «falta evidencia», y no acusa.
// ============================================================

// Los tres estados del adhesivo. Cada uno lleva su palabra y su símbolo
// porque el color NO PUEDE SER EL ÚNICO PORTADOR: este adhesivo se lee a
// tres metros, con sol de frente, y por gente que no distingue verde de
// ámbar.
export const ESTADOS = {
  contrastado: {
    clave: 'contrastado',
    palabra: 'CONTRASTADO',
    simbolo: '✓',
    color: '#28a745',
    explica: 'Los consumos declarados calzan con los documentos del período, y esos documentos están sellados.',
  },
  falta_evidencia: {
    clave: 'falta_evidencia',
    palabra: 'FALTA EVIDENCIA',
    simbolo: '!',
    color: '#d97706',
    explica: 'El expediente está abierto y hay documentos que no llegaron. No dice que algo esté mal: dice que todavía no se puede afirmar.',
  },
  sin_comparacion: {
    clave: 'sin_comparacion',
    palabra: 'SIN COMPARACIÓN',
    simbolo: '–',
    color: '#64748b',
    explica: 'No hay línea base contra la cual medir todavía. Es el estado honesto de un activo recién incorporado.',
  },
};

// Código del activo: AC- + 16 hexadecimales.
//
// Mismo largo que el serial de la Tarjeta de Viaje y por el mismo motivo:
// es la ÚNICA credencial de una página pública. Con cuatro caracteres se
// podría barrer el espacio entero y averiguar qué empresas están siendo
// auditadas y con qué activos — información que no le corresponde a
// cualquiera que pruebe códigos.
const BYTES_CODIGO = 8;

export function generarCodigoActivo() {
  return `AC-${crypto.randomBytes(BYTES_CODIGO).toString('hex').toUpperCase()}`;
}

export function codigoActivoValido(c) {
  return /^AC-[0-9A-F]{16}$/.test(String(c || ''));
}

// El estado del activo a partir de los expedientes de su contrato.
//
// `coberturas` son los porcentajes de cobertura documental de cada
// expediente del par (proveedor, contrato). Se recibe ya calculado para
// que esta función no dependa de la base ni de cómo se consulta.
//
// Sin expedientes → gris. No es cero: es que no hay con qué comparar, que
// es la doctrina del resto del producto. Un activo recién incorporado no
// merece un color que insinúe incumplimiento.
export function estadoActivo(coberturas = []) {
  const validas = (coberturas || []).filter((c) => c !== null && c !== undefined && Number.isFinite(Number(c)));
  if (!validas.length) return ESTADOS.sin_comparacion;

  // El peor expediente manda. Si de tres contratos uno está incompleto,
  // el activo no está contrastado — decir que sí porque los otros dos
  // cierran sería exactamente el verde falso que este producto evita.
  const peor = Math.min(...validas.map(Number));
  const color = semaforoExpediente(peor);

  if (color === 'verde') return ESTADOS.contrastado;
  if (color === 'gris') return ESTADOS.sin_comparacion;
  // 'amarillo' y 'rojo' colapsan en el mismo estado: ver la nota de
  // arriba sobre por qué el adhesivo no tiene rojo.
  return ESTADOS.falta_evidencia;
}

// Lo que sale a la página pública del activo.
//
// Lista blanca, no descarte: `identificador_interno` (la patente) y el
// `proveedor_id` NO salen. La patente identifica un móvil y no hace falta
// para leer el estado de su evidencia; publicarla convertiría el adhesivo
// en un rastreador para cualquiera que lo fotografíe.
export function activoPublico(fila = {}, coberturas = []) {
  const e = estadoActivo(coberturas);
  return {
    codigo: fila.codigo || null,
    nombre: fila.nombre || null,
    tipo: fila.tipo || 'otro',
    contrato: fila.contrato || null,
    periodo_desde: fila.periodo_desde || null,
    periodo_hasta: fila.periodo_hasta || null,
    estado: e.clave,
    estado_palabra: e.palabra,
    estado_simbolo: e.simbolo,
    estado_color: e.color,
    estado_explica: e.explica,
  };
}
