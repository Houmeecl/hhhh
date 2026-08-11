#!/usr/bin/env node
// Modelo de valorización del proyecto sicr3p — proyección de flujo de caja
// a 5 años y cálculo de TIR/VAN sobre esa proyección.
//
// sicr3p está en pre-lanzamiento (sin ventas facturadas todavía), así que
// TODO lo que sale de este script es una PROYECCIÓN/ESTIMACIÓN de la
// administración, no un histórico. Los supuestos de abajo son ilustrativos
// y están pensados para ajustarse con cifras reales antes de usar el
// resultado con un inversionista real — en particular RONDA_CLP y
// TASA_DESCUENTO_ANUAL, que son los dos supuestos que más mueven la TIR.
//
// Uso: node valorizacion.mjs
// Salida: tabla de flujo de caja + TIR/VAN por escenario, en consola.
// Esa salida es la que se transcribe a mano al informe HTML
// (docs/comercial/fuente/11-valorizacion-proyecto.html), igual que el
// resto de docs/comercial/ (fuente HTML, sin pipeline automático de datos).

const HORIZONTE_ANIOS = 5;
const RONDA_CLP = 150_000_000; // supuesto ilustrativo — ajustar con el monto real de la ronda
const TASA_DESCUENTO_ANUAL = 0.18; // 18% anual — tasa de descuento típica para etapa pre-revenue en LatAm

// Líneas de ingreso: mismas 4 del informe de financiamiento (doc 06).
// `anual1..5`: ingreso proyectado por año (CLP), ya neto de la curva de
// adopción de cada escenario (ver ESCENARIOS abajo, que escala estos
// montos base).
const LINEAS_BASE = [
  { nombre: 'Suscripción SaaS', anual: [8_000_000, 28_000_000, 62_000_000, 105_000_000, 150_000_000] },
  { nombre: 'Tramitación en mostrador presencial', anual: [4_000_000, 16_000_000, 38_000_000, 68_000_000, 95_000_000] },
  { nombre: 'Pasaportes de origen', anual: [3_000_000, 12_000_000, 30_000_000, 55_000_000, 80_000_000] },
  { nombre: 'API mandantes', anual: [0, 6_000_000, 20_000_000, 42_000_000, 65_000_000] },
];

// Costos operativos proyectados (equipo comercial, infraestructura, soporte).
const COSTOS_BASE = [18_000_000, 42_000_000, 68_000_000, 95_000_000, 120_000_000];

// Escenarios: factor que escala los ingresos base (la velocidad de
// adopción es el supuesto más incierto en pre-lanzamiento). Los costos no
// se escalan — se asume la misma estructura de equipo en los 3 casos.
const ESCENARIOS = {
  conservador: 0.6,
  base: 1.0,
  optimista: 1.4,
};

function flujoCaja(factorAdopcion) {
  const ingresosPorAnio = Array.from({ length: HORIZONTE_ANIOS }, (_, i) =>
    LINEAS_BASE.reduce((acc, linea) => acc + linea.anual[i] * factorAdopcion, 0)
  );
  const flujo = [-RONDA_CLP]; // año 0: inversión inicial
  for (let i = 0; i < HORIZONTE_ANIOS; i++) {
    flujo.push(ingresosPorAnio[i] - COSTOS_BASE[i]);
  }
  return { ingresosPorAnio, flujo };
}

// VAN (NPV) a la tasa dada.
function van(flujo, tasa) {
  return flujo.reduce((acc, cf, t) => acc + cf / Math.pow(1 + tasa, t), 0);
}

// TIR (IRR) por bisección sobre VAN(tasa) = 0. Simple, sin dependencias:
// asume un único cambio de signo (inversión negativa seguida de flujos
// positivos), válido para este modelo.
function tir(flujo, { min = -0.99, max = 5, iter = 200, tol = 1e-7 } = {}) {
  let lo = min, hi = max;
  let vLo = van(flujo, lo), vHi = van(flujo, hi);
  if (Math.sign(vLo) === Math.sign(vHi)) return null; // no hay raíz en el rango
  for (let i = 0; i < iter; i++) {
    const mid = (lo + hi) / 2;
    const vMid = van(flujo, mid);
    if (Math.abs(vMid) < tol) return mid;
    if (Math.sign(vMid) === Math.sign(vLo)) { lo = mid; vLo = vMid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

function clp(n) {
  return Math.round(n).toLocaleString('es-CL');
}

console.log('=== Modelo de valorización — sicr3p ===');
console.log(`Ronda solicitada: $${clp(RONDA_CLP)} CLP · Tasa de descuento: ${(TASA_DESCUENTO_ANUAL * 100).toFixed(0)}% anual · Horizonte: ${HORIZONTE_ANIOS} años\n`);

for (const [nombre, factor] of Object.entries(ESCENARIOS)) {
  const { ingresosPorAnio, flujo } = flujoCaja(factor);
  const vanCalc = van(flujo, TASA_DESCUENTO_ANUAL);
  const tirCalc = tir(flujo);

  console.log(`--- Escenario: ${nombre} (factor de adopción ${factor}x) ---`);
  console.log('Año  | Ingresos (CLP)  | Costos (CLP)    | Flujo neto (CLP)');
  console.log(`0    | —               | —               | ${clp(flujo[0]).padStart(15)}  (inversión inicial)`);
  for (let i = 0; i < HORIZONTE_ANIOS; i++) {
    console.log(`${i + 1}    | ${clp(ingresosPorAnio[i]).padStart(15)} | ${clp(COSTOS_BASE[i]).padStart(15)} | ${clp(flujo[i + 1]).padStart(15)}`);
  }
  console.log(`VAN (@ ${(TASA_DESCUENTO_ANUAL * 100).toFixed(0)}%): $${clp(vanCalc)} CLP`);
  console.log(`TIR: ${tirCalc === null ? 'no converge (flujo no cambia de signo)' : (tirCalc * 100).toFixed(1) + '% anual'}`);
  console.log('');
}
