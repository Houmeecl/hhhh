// RUT chileno (módulo 11). Portado de frontend/src/lib/rut.js.
export function limpiarRut(rut) {
  return String(rut || '').toUpperCase().replace(/[^0-9K]/g, '');
}
export function dvRut(cuerpo) {
  let suma = 0, mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const resto = 11 - (suma % 11);
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
}
export function validarRut(rut) {
  const l = limpiarRut(rut);
  if (l.length < 2) return false;
  const cuerpo = l.slice(0, -1);
  const dv = l.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  return dvRut(cuerpo) === dv;
}
export function formatearRut(rut) {
  const l = limpiarRut(rut);
  if (l.length < 2) return l;
  const cuerpo = l.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${l.slice(-1)}`;
}
