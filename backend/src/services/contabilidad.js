import crypto from 'crypto';

export const TIPOS_CUENTA = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto'];

export const CUENTAS_BASE = [
  ['1101', 'Caja y bancos', 'activo', 'caja'],
  ['1102', 'Cuentas por cobrar', 'activo', 'cuentas_cobrar'],
  ['2101', 'Proveedores', 'pasivo', 'pasivo_corriente'],
  ['2102', 'Impuestos por pagar', 'pasivo', 'pasivo_corriente'],
  ['3101', 'Capital', 'patrimonio', 'patrimonio'],
  ['4101', 'Ingresos por servicios', 'ingreso', 'ingreso'],
  ['5101', 'Gastos operacionales', 'gasto', 'gasto'],
  ['5102', 'Costo de ventas', 'costo', 'costo'],
];

export const ROLES_BANCARIOS = ['caja','cuentas_cobrar','inventario','activo_corriente','activo_no_corriente','pasivo_corriente','deuda_financiera','patrimonio','ingreso','costo','gasto','otro'];

const dinero = (valor) => Math.round(Number(valor || 0) * 100) / 100;

export function validarLineas(lineas) {
  if (!Array.isArray(lineas) || lineas.length < 2) return { ok: false, error: 'Un asiento requiere al menos dos líneas.' };
  let debito = 0;
  let haber = 0;
  for (const linea of lineas) {
    if (!linea?.cuenta_id) return { ok: false, error: 'Cada línea debe indicar una cuenta.' };
    const d = dinero(linea.debito);
    const h = dinero(linea.haber);
    if ((d > 0 && h > 0) || (d <= 0 && h <= 0)) return { ok: false, error: 'Cada línea debe tener un débito o un haber, no ambos.' };
    if (d < 0 || h < 0) return { ok: false, error: 'Los importes no pueden ser negativos.' };
    debito += d;
    haber += h;
  }
  debito = dinero(debito);
  haber = dinero(haber);
  if (debito !== haber) return { ok: false, error: `El asiento no cuadra: débito ${debito.toFixed(2)} y haber ${haber.toFixed(2)}.` };
  return { ok: true, debito, haber };
}

export function hashAsiento({ cliente_id, periodo_id, numero, fecha, glosa, referencia, lineas }) {
  const contenido = JSON.stringify({
    cliente_id, periodo_id, numero, fecha, glosa: String(glosa || '').trim(), referencia: referencia || null,
    lineas: lineas.map((l) => ({ cuenta_id: l.cuenta_id, debito: dinero(l.debito).toFixed(2), haber: dinero(l.haber).toFixed(2), glosa: l.glosa || null })),
  });
  return crypto.createHash('sha256').update(contenido).digest('hex');
}

export function perfilFinanciero({ cuentas = [], nAsientos = 0, coberturaRespaldo = 0, ultimoAsiento = null, hoy = new Date() }) {
  const monto = (c, lado) => Number(c[lado] || 0);
  const porRol = (roles, lado) => cuentas.filter((c) => roles.includes(c.rol_bancario)).reduce((n, c) => n + monto(c, lado), 0);
  const activosCorrientes = porRol(['caja','cuentas_cobrar','inventario','activo_corriente'], 'saldo_deudor');
  const pasivosCorrientes = porRol(['pasivo_corriente'], 'saldo_acreedor');
  const deudaFinanciera = porRol(['deuda_financiera'], 'saldo_acreedor');
  const patrimonio = porRol(['patrimonio'], 'saldo_acreedor');
  const ingresos = porRol(['ingreso'], 'saldo_acreedor');
  const egresos = porRol(['costo','gasto'], 'saldo_deudor');
  const roles = new Set(cuentas.map((c) => c.rol_bancario));
  const alertas = [];
  if (!nAsientos) alertas.push({ nivel: 'alto', codigo: 'SIN_ASIENTOS', texto: 'No hay asientos registrados en el período.' });
  if (!roles.has('caja') || !roles.has('pasivo_corriente')) alertas.push({ nivel: 'medio', codigo: 'LIQUIDEZ_INCOMPLETA', texto: 'Faltan roles de caja o pasivo corriente; la liquidez no se puede interpretar.' });
  const razonLiquidez = pasivosCorrientes > 0 ? activosCorrientes / pasivosCorrientes : null;
  if (razonLiquidez != null && razonLiquidez < 1) alertas.push({ nivel: 'alto', codigo: 'LIQUIDEZ_BAJA', texto: 'Los activos corrientes registrados son menores que los pasivos corrientes registrados.' });
  const deudaPatrimonio = patrimonio > 0 ? deudaFinanciera / patrimonio : null;
  if (deudaPatrimonio != null && deudaPatrimonio > 2) alertas.push({ nivel: 'medio', codigo: 'APALANCAMIENTO_ALTO', texto: 'La deuda financiera registrada supera dos veces el patrimonio registrado.' });
  if (nAsientos && coberturaRespaldo < 0.5) alertas.push({ nivel: 'medio', codigo: 'RESPALDO_PARCIAL', texto: 'Menos de la mitad de los asientos tiene una referencia documental o SII declarada.' });
  let diasSinMovimiento = null;
  if (ultimoAsiento) diasSinMovimiento = Math.max(0, Math.floor((new Date(`${hoy.toISOString().slice(0, 10)}T00:00:00Z`) - new Date(`${ultimoAsiento}T00:00:00Z`)) / 86400000));
  if (diasSinMovimiento != null && diasSinMovimiento > 90) alertas.push({ nivel: 'medio', codigo: 'INFORMACION_DESACTUALIZADA', texto: 'El último asiento del período tiene más de 90 días.' });
  const estado = !nAsientos ? 'datos_insuficientes' : alertas.some((a) => a.nivel === 'alto') ? 'requiere_revision' : coberturaRespaldo >= 0.5 ? 'informacion_estructurada' : 'informacion_parcial';
  return {
    estado, alertas, metricas: { activos_corrientes: activosCorrientes, pasivos_corrientes: pasivosCorrientes, razon_liquidez: razonLiquidez, deuda_financiera: deudaFinanciera, patrimonio, deuda_patrimonio: deudaPatrimonio, ingresos, egresos, resultado_periodo: ingresos - egresos, n_asientos: nAsientos, cobertura_respaldo: coberturaRespaldo, ultimo_asiento: ultimoAsiento, dias_sin_movimiento: diasSinMovimiento },
  };
}
