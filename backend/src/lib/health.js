import { query } from './db.js';

// SELECT 1 con plazo corto — separado de index.js para poder inyectar la
// función de consulta en el test y probar el camino "caído" sin depender de
// temporizadores reales ni de apagar la BD de verdad.
export async function estaSano(timeoutMs = 2000, queryFn = query) {
  let temporizador;
  try {
    await Promise.race([
      queryFn('SELECT 1'),
      new Promise((_, reject) => { temporizador = setTimeout(() => reject(new Error('timeout BD')), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}
