// ============================================================
// Export entregable del inventario de emisiones de un período SII,
// por Alcance GHG (1/2/3) y categoría — el "archivo formato" que la
// empresa presenta a procesos externos (programa HuellaChile del MMA,
// verificadores que ella contrate). Compartido por la ruta admin y la
// del panel proveedor: una sola forma del documento, dos puertas.
//
// Honestidad (misma regla central de agregarPorAlcance): solo llevan
// alcance las categorías que salieron de la glosa real de los ítems;
// el saldo restante va al pie CON SU CAUSA, nunca escondido — un CSV
// sin ese pie se leería como si cubriera todo el gasto clasificado.
// sicr3p prepara el insumo; el reconocimiento externo es de la empresa
// titular, nunca de sicr3p ni a través de sicr3p.
// ============================================================
import { filasACsv } from './csv.js';
import { MOTIVOS_SIN_ALCANCE } from './categoriaPresentacion.js';
import { CITA_CATEGORIAS_ALCANCE3 } from './alcanceGhg.js';

// Aplana por_alcance (agregarPorAlcance) a una fila por categoría, con su
// alcance, la categoría canónica del GHG Protocol (solo A3), el método con
// que se calculó y la(s) fuente(s) del factor citadas desde el snapshot
// congelado de la versión del motor usada en el cálculo.
export function filasInventario(porAlcance) {
  const filas = [];
  for (const a of porAlcance?.alcances || []) {
    for (const c of a.categorias || []) {
      filas.push({
        alcance: a.alcance,
        categoria_ghg_numero: c.categoria_ghg ?? null,
        categoria_ghg_nombre: c.categoria_ghg_nombre ?? null,
        categoria_motor: c.nombre,
        n_documentos: c.n_documentos,
        n_fisico: c.n_fisico ?? 0,
        n_gasto: c.n_documentos - (c.n_fisico ?? 0),
        total_tco2e: c.tco2e,
        fuente_factor: c.fuente_factor || null,
      });
    }
  }
  return filas;
}

// Texto del saldo sin alcance, por causa — para el pie del CSV y el JSON.
function causasSinAlcance(sin) {
  return MOTIVOS_SIN_ALCANCE
    .filter(([clave]) => sin?.[clave] > 0)
    .map(([clave, texto]) => `${sin[clave]} ${texto}`)
    .join(', ');
}

// CSV completo (sin BOM: lo agrega la ruta al enviar, patrón export/alcance3).
// Números en formato de máquina (punto decimal): es un archivo de datos.
export function inventarioCsv({ analisis }) {
  const em = analisis?.emisiones;
  const filas = filasInventario(em?.por_alcance);
  const headers = [
    'alcance', 'categoria_ghg_numero', 'categoria_ghg_nombre_ghg_protocol',
    'categoria_motor', 'n_documentos', 'n_por_unidades_fisicas', 'n_por_gasto',
    'total_tco2e', 'fuente_factor',
  ];
  const csv = filasACsv(headers, filas.map((f) => ({
    alcance: f.alcance,
    categoria_ghg_numero: f.categoria_ghg_numero ?? '',
    categoria_ghg_nombre_ghg_protocol: f.categoria_ghg_nombre ?? '',
    categoria_motor: f.categoria_motor,
    n_documentos: f.n_documentos,
    n_por_unidades_fisicas: f.n_fisico,
    n_por_gasto: f.n_gasto,
    total_tco2e: f.total_tco2e.toFixed(4),
    fuente_factor: f.fuente_factor ?? '',
  })));

  const sin = em?.por_alcance?.sin_clasificar;
  const pies = [];
  if (sin?.n_documentos > 0) {
    pies.push(`# ${sin.n_documentos} documento(s) por ${sin.tco2e.toFixed(4)} tCO2e sin alcance atribuible (${causasSinAlcance(sin) || 'sin categoría asignada'}): incluidos en el total del período, no en las filas de arriba.`);
  }
  if (em) {
    pies.push(`# Total del período: ${em.total_co2e_tref.toFixed(4)} tCO2e sobre ${em.documentos_calculados} de ${em.documentos_totales} documentos de compra.`);
    if (em.motor_versiones?.length) pies.push(`# Motor de cálculo v${em.motor_versiones.join(', v')}.`);
  }
  pies.push(`# Taxonomia Alcance 3: ${CITA_CATEGORIAS_ALCANCE3}.`);
  pies.push('# Insumo preparado por sicr3p para procesos de reporte o verificacion externos: no constituye certificacion ni verificacion de tercera parte.');
  return `${csv}\n${pies.join('\n')}\n`;
}

// Cuerpo JSON del mismo export (formato=json).
export function inventarioJson({ empresa, periodo, analisis }) {
  const em = analisis?.emisiones;
  return {
    empresa: { nombre_empresa: empresa?.nombre_empresa, rut: empresa?.rut },
    periodo,
    total_tco2e: em?.total_co2e_tref ?? null,
    documentos_calculados: em?.documentos_calculados ?? 0,
    documentos_totales: em?.documentos_totales ?? 0,
    motor_versiones: em?.motor_versiones ?? [],
    filas: filasInventario(em?.por_alcance),
    sin_alcance: em?.por_alcance?.sin_clasificar ?? null,
    metodologia: { taxonomia_categorias_alcance3: CITA_CATEGORIAS_ALCANCE3 },
    aviso: 'Insumo preparado para procesos de reporte o verificación externos (ej. programa HuellaChile del MMA, que reconoce a la empresa titular — nunca a sicr3p ni a través de sicr3p). No constituye certificación ni verificación de tercera parte.',
  };
}
