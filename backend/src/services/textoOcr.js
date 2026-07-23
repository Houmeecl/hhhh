// ============================================================
// Normalizaciones de texto compartidas para tolerar errores de OCR.
//
// Dos direcciones OPUESTAS, cada una para su contexto:
//  - normalizarOcr:        dígitos → letras (0→o, 1→l, rn→m), para
//    comparar GLOSAS contra palabras clave ("e1ectricidad").
//  - normalizarDigitosOcr: letras → dígitos (O→0, l/I→1), SOLO dentro
//    de tokens candidatos a RUT o monto — jamás sobre el texto completo,
//    porque desharía la normalización de glosas. La red de seguridad es
//    que después validan el módulo 11 (RUT) o el parser de montos.
// ============================================================

// Texto sin tildes ni mayúsculas, para comparar contra palabras clave.
export function limpiar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quita tildes
}

// Confusiones típicas de OCR en GLOSAS (0/O→o, 1/l→l, rn→m), para que un
// error de reconocimiento no le cueste la categoría a un ítem real
// (ej. "e1ectricidad" u "0.NEMESA rnaritirno").
export function normalizarOcr(s) {
  return s.replace(/[01]/g, (c) => (c === '0' ? 'o' : 'l')).replace(/rn/g, 'm');
}

// Confusiones típicas de OCR en NÚMEROS (O/o→0, l/I→1). Aplicar solo a un
// token que ya contiene al menos un dígito real — un token de puras letras
// no es un número mal leído, es una palabra.
export function normalizarDigitosOcr(token) {
  return String(token || '').replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
}
