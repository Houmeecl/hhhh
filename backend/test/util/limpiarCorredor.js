import { queryCorredor } from '../../src/lib/dbCorredor.js';

// ============================================================
// Limpieza de los datos que dejan los tests del Corredor.
//
// EL BUG QUE ESTE ARCHIVO CIERRA. Cada archivo de test limpiaba así:
//
//     await queryCorredor(`DELETE FROM exportadores WHERE ...`).catch(() => {});
//
// Y ese DELETE **fallaba siempre**. De las ocho llaves foráneas que apuntan
// a `cargas` y `exportadores`, siete son ON DELETE CASCADE y una no:
//
//     cargas → exportadores   ON DELETE RESTRICT
//
// Así que borrar el exportador antes que sus cargas viola la llave, y el
// `.catch(() => {})` se tragaba el error sin dejar rastro.
//
// Medido el 01-09-2026 sobre la base local: **366 exportadores, 1.543
// cargas y 357 usuarios** acumulados, 364 de esos exportadores basura de
// tests. Con suficiente basura, los tests que listan o cuentan filas
// empiezan a fallar, y fallan DISTINTOS en cada corrida según qué alcanzó
// a acumularse: dos corridas seguidas dieron 25 y 39 fallas **sin una sola
// en común**, y todas pasaban aisladas. Eso es peor que una suite roja:
// es una suite a la que nadie le cree.
//
// Misma falta que el `continue` mudo del derecho de acceso ARCOP —un error
// tapado— y por eso acá no se tapa nada.
//
// QUE `cargas` SEA RESTRICT NO ES UN DESCUIDO. Una carga es evidencia
// sellada de un cruce que ocurrió; que se borre sola porque alguien dio de
// baja una empresa sería justamente lo que este producto evita. El que
// estaba mal era el orden de la limpieza, no la llave.
// ============================================================

// Borra las cargas de los exportadores que calcen con `patron` (un LIKE
// sobre nombre_empresa) y después los exportadores. El CASCADE se lleva
// parcelas, usuarios, pasos, documentos, tramos y producción.
//
// NO SE TRAGA EL ERROR: si algo falla lo dice por consola con la tabla. No
// lanza —tumbar el `after()` de un test que ya pasó sería peor— pero queda
// a la vista, que es lo único que impide que esto vuelva a acumularse
// callado durante meses.
export async function limpiarCorredorPorEmpresa(patron) {
  const fallaron = [];
  const paso = async (etiqueta, sql) => {
    try {
      await queryCorredor(sql, [patron]);
    } catch (e) {
      // Una tabla que todavía no existe en este entorno no es una falla de
      // limpieza: el Corredor puede estar a medio migrar.
      if (e?.code === '42P01') return;
      fallaron.push(etiqueta);
      console.error(`[limpiarCorredor] no se pudo limpiar ${etiqueta}: ${e.message}`);
    }
  };

  await paso('cargas',
    'DELETE FROM cargas WHERE exportador_id IN (SELECT id FROM exportadores WHERE nombre_empresa LIKE $1)');
  await paso('exportadores',
    'DELETE FROM exportadores WHERE nombre_empresa LIKE $1');
  return fallaron;
}

// Los correos de usuario no siempre calzan con el nombre de la empresa
// —varios tests los nombran `algo-SUFIJO@ejemplo.cl`—, así que va aparte.
// Para los que sí cuelgan de un exportador borrado, el CASCADE ya se
// encargó y esto no encuentra nada, que es lo correcto.
export async function limpiarUsuariosCorredor(patronEmail) {
  try {
    await queryCorredor('DELETE FROM usuarios_corredor WHERE email LIKE $1', [patronEmail]);
    return [];
  } catch (e) {
    if (e?.code === '42P01') return [];
    console.error(`[limpiarCorredor] no se pudo limpiar usuarios_corredor: ${e.message}`);
    return ['usuarios_corredor'];
  }
}
