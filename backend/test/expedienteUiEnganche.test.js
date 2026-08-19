import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Que la pantalla pueda producir un documento CON RESPALDO.
//
// EL BUG QUE ESTE CASO IMPIDE QUE VUELVA, y que ningún test de backend
// podía ver: `AgregarDocumento` armaba su payload desde un objeto `vacio`
// que NO tenía `dte_proveedor_id` ni `factura_id`. El backend estaba
// perfecto —validaba la pertenencia del vínculo, contaba los respaldos,
// tenía sus tests verdes— pero la UI no le mandaba nunca el vínculo.
// Consecuencias, todas invisibles desde el backend:
//
//   · «X de Y documentos con respaldo en sicr3p» decía 0 siempre.
//   · El badge «En sicr3p» era inalcanzable: todo salía «Solo declarado».
//   · Cada documento agregado generaba además una brecha.
//   · GET /candidatos y la validación de pertenencia del dte_proveedor_id
//     quedaban sin ningún consumidor.
//
// Es un test que lee el FUENTE, no que ejecuta el componente, y eso tiene
// un límite honesto: comprueba que la línea esté, no que el usuario logre
// apretar el botón. Se hace así porque el proyecto no tiene arnés de
// navegador, y el precedente de leer archivos desde un test ya existe
// (inventarioDatos.test.js lee las migraciones). Cubre exactamente la
// regresión que ocurrió: que el vínculo desaparezca del payload.
// ============================================================

const RUTA = path.join(
  import.meta.dirname, '..', '..', 'frontend', 'src', 'panel-proveedor', 'Expedientes.jsx'
);

const fuente = fs.readFileSync(RUTA, 'utf8');

test('el formulario manda el vínculo al RCV, no solo texto suelto', () => {
  // La línea sin la cual todo documento nace "solo declarado".
  assert.match(fuente, /dte_proveedor_id:\s*desdeRcv\?\.id/,
    'el payload de proveedorExpedienteAgregarDoc perdió el dte_proveedor_id');
});

test('los candidatos del RCV tienen cómo engancharse', () => {
  // Sin un onClick que fije la compra elegida, /candidatos es una tabla
  // decorativa y el vínculo nunca se puede formar desde la pantalla.
  assert.match(fuente, /setDesdeRcv\(c\)/,
    'la tabla de candidatos ya no permite elegir una compra');
  assert.match(fuente, /proveedorExpedienteCandidatos/,
    'la pantalla dejó de consultar los candidatos del RCV');
});

test('la cantidad por documento viaja: es lo que hace comparable la evidencia', () => {
  // verificarConsistencia() compara la cantidad que declara cada
  // documento. Si el formulario no la manda, no hay nada que comparar y
  // el nivel 3 (consistente) es inalcanzable desde la pantalla — el mismo
  // patrón de bug que el vínculo.
  assert.match(fuente, /cantidad:\s*form\.cantidad === ''/,
    'el payload perdió la cantidad declarada por el documento');
});

test('la pantalla distingue "con respaldo" de "solo declarado"', () => {
  // Los dos caminos son legítimos, pero significan cosas distintas y
  // tienen que verse distintas.
  assert.match(fuente, /Solo declarado/);
  assert.match(fuente, /En sicr3p/);
});

test('el gris del alcance no se rellena con una categoría por defecto', () => {
  // Es la única pantalla donde sicr3p afirma algo sobre la contabilidad
  // del cliente. Si no hay categoría, no se inventa una.
  assert.match(fuente, /resumen\.scope\.cliente\.categoria_potencial \?/,
    'la clasificación potencial volvió a imprimirse sin comprobar que exista');
  assert.match(fuente, /Sin categoría/);
});

test('«Cerrar expediente» y «Volver» son dos acciones distintas', () => {
  // Antes el único botón "Cerrar" solo cerraba la tarjeta, mientras el
  // backend mandaba al proveedor a "cerrar el expediente" — una acción
  // que no existía en la UI.
  assert.match(fuente, /Cerrar expediente/);
  assert.match(fuente, />Volver</);
  assert.match(fuente, /estado: 'cerrado'/,
    'no hay forma de cerrar un expediente desde la pantalla');
  assert.match(fuente, /estado: 'abierto'/,
    'un expediente cerrado no se puede reabrir');
});
