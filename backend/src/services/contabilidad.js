import crypto from 'crypto';

export const TIPOS_CUENTA = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto'];

export const CUENTAS_BASE = [
  ['1101', 'Caja y bancos', 'activo'],
  ['1102', 'Cuentas por cobrar', 'activo'],
  ['2101', 'Proveedores', 'pasivo'],
  ['2102', 'Impuestos por pagar', 'pasivo'],
  ['3101', 'Capital', 'patrimonio'],
  ['4101', 'Ingresos por servicios', 'ingreso'],
  ['5101', 'Gastos operacionales', 'gasto'],
  ['5102', 'Costo de ventas', 'costo'],
];

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
