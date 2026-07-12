// Utilidades de RUT chileno (módulo 11).

// Limpia: deja solo dígitos y K.
export function limpiarRut(rut) {
  return String(rut || '').toUpperCase().replace(/[^0-9K]/g, '');
}

// Calcula el dígito verificador de un cuerpo numérico.
export function dvRut(cuerpo) {
  let suma = 0;
  let mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

// Valida un RUT completo (con o sin puntos/guion).
export function validarRut(rut) {
  const limpio = limpiarRut(rut);
  if (limpio.length < 2) return false;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  return dvRut(cuerpo) === dv;
}

// Formatea con puntos y guion: 12345678K -> 12.345.678-K
export function formatearRut(rut) {
  const limpio = limpiarRut(rut);
  if (limpio.length < 2) return limpio;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${conPuntos}-${dv}`;
}
