import { query } from '../lib/db.js';
import { SQL_CATEGORIA_ATRIBUIBLE } from './categoriaPresentacion.js';

// ============================================================
// Cadena comprador-vendedor de un RUT: quién le emitió documentos
// (proveedores) y a quién le emitió (compradores) — derivado de
// `facturas`, ya procesadas por sicr3p. Compartido entre
// routes/informes.js (GET /cadena) y la Carpeta del mandante
// (services/pdf.js vía routes/public.js), sin duplicar el SQL.
// ============================================================

const rutNorm = (r) => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();

export async function contrapartesDeRut(rut) {
  const rn = rutNorm(rut);
  // Como comprador: proveedores que le emiten documentos.
  const { rows: proveedores } = await query(
    `SELECT f.rut_emisor AS rut, COUNT(*)::int AS n_documentos,
            SUM(f.total_co2e)::float AS total_co2e,
            MAX(f.created_at) AS ultimo_documento,
            -- Solo las categorías atribuibles: el catch-all del motor no es una
            -- clasificación del documento (services/categoriaPresentacion.js).
            -- COALESCE: un FILTER que no calza ninguna fila devuelve NULL, no
            -- un arreglo vacío, y la Carpeta del mandante lo itera sin guarda.
            COALESCE(array_agg(DISTINCT f.categoria)
              FILTER (WHERE ${SQL_CATEGORIA_ATRIBUIBLE.replace('categoria_origen', 'f.categoria_origen')}), '{}')
              AS categorias
     FROM facturas f
     WHERE regexp_replace(COALESCE(f.rut_receptor,''), '[^0-9kK]', '', 'g') ILIKE $1
       AND f.rut_emisor IS NOT NULL
     GROUP BY f.rut_emisor ORDER BY total_co2e DESC NULLS LAST LIMIT 100`,
    [rn]
  );
  // Como vendedor: compradores que reciben sus documentos.
  const { rows: compradores } = await query(
    `SELECT f.rut_receptor AS rut, COUNT(*)::int AS n_documentos,
            SUM(f.total_co2e)::float AS total_co2e,
            MAX(f.created_at) AS ultimo_documento,
            -- Solo las categorías atribuibles: el catch-all del motor no es una
            -- clasificación del documento (services/categoriaPresentacion.js).
            -- COALESCE: un FILTER que no calza ninguna fila devuelve NULL, no
            -- un arreglo vacío, y la Carpeta del mandante lo itera sin guarda.
            COALESCE(array_agg(DISTINCT f.categoria)
              FILTER (WHERE ${SQL_CATEGORIA_ATRIBUIBLE.replace('categoria_origen', 'f.categoria_origen')}), '{}')
              AS categorias
     FROM facturas f
     WHERE regexp_replace(COALESCE(f.rut_emisor,''), '[^0-9kK]', '', 'g') ILIKE $1
       AND f.rut_receptor IS NOT NULL
     GROUP BY f.rut_receptor ORDER BY total_co2e DESC NULLS LAST LIMIT 100`,
    [rn]
  );
  const totalComprado = proveedores.reduce((a, p) => a + Number(p.total_co2e || 0), 0);
  const totalVendido = compradores.reduce((a, c) => a + Number(c.total_co2e || 0), 0);
  return {
    rut,
    resumen: {
      n_proveedores: proveedores.length,
      n_compradores: compradores.length,
      co2e_comprado: Math.round(totalComprado * 10000) / 10000,
      co2e_vendido: Math.round(totalVendido * 10000) / 10000,
    },
    proveedores, compradores,
  };
}
