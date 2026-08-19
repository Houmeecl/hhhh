// ============================================================
// Listo para exportar — funciones PURAS.
//
// POR QUÉ EXISTE. Hasta acá el pasaporte medía su completitud contra UN
// solo régimen: CBAM (`resumenNormativo().cbam` en pasaporteOrigen.js).
// Eso deja fuera lo que más se le va a pedir a una carga del Corredor
// Bioceánico, por dos motivos distintos:
//
//  · CBAM NO CUBRE EL COBRE NI EL LITIO. Su Anexo I es cemento,
//    electricidad, hidrógeno, fertilizantes, hierro/acero y aluminio.
//    Con un solo régimen, el exportador de cátodos queda mirando un
//    semáforo CBAM en rojo permanente por una obligación que nunca tuvo.
//
//  · EUDR SÍ CUBRE LO QUE ESE CORREDOR MUEVE. El Reglamento (UE)
//    2023/1115 alcanza bovinos, cacao, café, palma, caucho, SOYA y
//    madera — la carga típica del Cono Sur. Y exige algo que CBAM no
//    pide: la GEOLOCALIZACIÓN de cada parcela donde se produjo.
//
// LOS DOS CASTIGAN DISTINTO, Y ESO CAMBIA LA CONVERSACIÓN COMERCIAL.
// CBAM no prohíbe entrar: cobra. Sin datos se aplican valores por
// defecto, que salen caros — es un problema de precio. EUDR no cobra:
// prohíbe la comercialización. Sin coordenadas el producto no entra, y
// no hay arancel que lo compense. Por eso cada régimen lleva su
// `consecuencia` y la pantalla la muestra: "te va a costar más" y "no
// vas a poder vender" no se atienden con la misma urgencia.
//
// Tres regímenes y una cuarta respuesta:
//
//   'eudr'          Anexo I de 2023/1115 → parcelas geolocalizadas, fecha
//                   de producción, libre de deforestación posterior al
//                   corte, y legalidad en el país de producción.
//   'cbam'          Anexo I de 2023/956 → cinco datos de emisiones.
//   'exportacion'   ninguno de los dos → lo que el COMPRADOR necesita
//                   para su propio Alcance 3 o su DPP.
//   (vacío)         todavía no se sabe. Ver abajo.
//
// SIN CÓDIGO ARANCELARIO NO SE OPINA. Es la decisión que más pesa acá.
// Caer a 'exportacion' por defecto sería cómodo y sería falso: una carga
// de soya sin código declarado SÍ está bajo EUDR, y mostrarla como "solo
// exportación" la haría verse en regla justo donde no lo está. Mismo
// criterio que el gris de `semaforoDocumental` y que la cobertura null de
// expediente.js: cuando no hay con qué decidir, no se opina.
//
// LO QUE ESTO SIGUE SIN SER. No es la declaración CBAM, ni la Declaración
// de Diligencia Debida del EUDR, ni el trámite aduanero. Es el estado de
// la evidencia que el exportador tendrá que entregar cuando le toque
// presentarlas. Ver docs/CORREDOR-ALCANCE.md.
// ============================================================

import { cbamAplicable, validarNc } from './pasaporteOrigen.js';

export const REGIMENES = ['eudr', 'cbam', 'exportacion'];

export const METODOS_EMISIONES = ['valores_reales', 'valores_defecto', 'mixto'];

// Fecha de corte del EUDR: la producción tiene que ser posterior. Está en
// el propio reglamento y no se ha movido — a diferencia de las fechas de
// APLICACIÓN, que se postergaron más de una vez y por eso NO se codifican
// acá. Una fecha de aplicación vencida escrita en el código sería peor
// que no tener ninguna: se lee como verdad y nadie la revisa.
export const CORTE_DEFORESTACION = '2020-12-31';

// Qué pasa si la carga llega sin lo que el régimen pide. No es color:
// decide a qué se le da prioridad.
export const CONSECUENCIA = {
  eudr: { tipo: 'prohibicion', texto: 'Sin esto el producto no se puede comercializar en la UE. No es un sobrecosto: es no entrar.' },
  cbam: { tipo: 'sobrecosto', texto: 'Sin esto el importador declara con valores por defecto, que salen más caros. Se paga, no se bloquea.' },
  exportacion: { tipo: 'comercial', texto: 'Sin esto el comprador no puede usar el dato en su propio inventario, y lo va a pedir igual.' },
};

// Anexo I del Reglamento (UE) 2023/1115, por partida arancelaria.
//
// ADVERTENCIA DELIBERADA: es un subconjunto de trabajo, no el Anexo I
// completo — el anexo se enmienda y tiene exclusiones por subpartida que
// cuatro dígitos no distinguen. Sirve para DECIR "revisa EUDR", nunca
// para concluir "no aplica". Por eso `regimenesDe` solo SUMA regímenes:
// no existe un camino que descarte EUDR afirmativamente.
export const COMMODITIES_EUDR = [
  { commodity: 'bovinos', etiqueta: 'Ganado bovino, carne y cueros', partidas: ['0102', '0201', '0202', '4101', '4104', '4107'] },
  { commodity: 'cacao', etiqueta: 'Cacao', partidas: ['1801', '1802', '1803', '1804', '1805', '1806'] },
  { commodity: 'cafe', etiqueta: 'Café', partidas: ['0901'] },
  { commodity: 'palma', etiqueta: 'Aceite de palma', partidas: ['1511', '151321', '151329', '230660', '382311', '382312', '382319'] },
  { commodity: 'caucho', etiqueta: 'Caucho', partidas: ['4001', '4005', '4006', '4007', '4008', '4010', '4011', '4012', '4013', '4015', '4016', '4017'] },
  { commodity: 'soya', etiqueta: 'Soya', partidas: ['1201', '120810', '2304'] },
  { commodity: 'madera', etiqueta: 'Madera, pasta y papel', partidas: ['4401', '4402', '4403', '4404', '4405', '4406', '4407', '4408', '4409', '4410', '4411', '4412', '4413', '4414', '4415', '4416', '4417', '4418', '4419', '4420', '4421', '4701', '4702', '4703', '4704', '4707', '4801', '4802', '4803', '4804', '4805', '4806', '4807', '4808', '4809', '4810', '4811', '4823', '940161', '940169', '940330', '940360', '940610'] },
];

// Qué commodity del EUDR es este código, o null.
export function commodityEudr(codigoNc) {
  const nc = String(codigoNc || '');
  if (!validarNc(nc)) return null;
  for (const c of COMMODITIES_EUDR) {
    if (c.partidas.some((p) => nc.startsWith(p))) return c;
  }
  return null;
}

export function eudrAplicable(codigoNc) {
  return commodityEudr(codigoNc) !== null;
}

// Cada requisito dice QUÉ falta y —lo que hace que la lista sirva— QUIÉN
// lo aporta. Un exportador que lee "faltan las emisiones indirectas" sin
// saber que eso se le pide a la generadora eléctrica se queda igual de
// trabado que antes.
const REQ = (campo, etiqueta, quien, comoSeObtiene) => ({ campo, etiqueta, quien, como_se_obtiene: comoSeObtiene });

// Los cinco del Reglamento (UE) 2023/956.
export const REQUISITOS_CBAM = [
  REQ('codigo_nc', 'Código NC de la mercadería', 'exportador',
    'Sale de la declaración de exportación. 4, 6 u 8 dígitos.'),
  REQ('faena_origen', 'Instalación de origen', 'exportador',
    'CBAM identifica la instalación, no basta el país.'),
  REQ('emisiones_directas_tco2e_t', 'Emisiones directas (t CO₂e / t)', 'operador de la instalación',
    'Del balance de la propia instalación productiva.'),
  REQ('emisiones_indirectas_tco2e_t', 'Emisiones indirectas (t CO₂e / t)', 'proveedor de electricidad',
    'De la energía comprada. Se pide al suministrador o se usa el factor de red.'),
  REQ('metodo_emisiones', 'Método de determinación', 'exportador',
    `Uno de: ${METODOS_EMISIONES.join(', ')}. Un número sin método no es declarable.`),
];

// Reglamento (UE) 2023/1115, art. 9 — la información que el operador tiene
// que recabar antes de poner el producto en el mercado.
//
// Cuatro de estos seis NO TIENEN DÓNDE GUARDARSE todavía en el esquema.
// Aparecen igual, y es a propósito: la brecha es el producto. Un
// requisito que no se muestra porque "no hay columna" es un requisito que
// el exportador descubre en la aduana.
export const REQUISITOS_EUDR = [
  REQ('codigo_nc', 'Código arancelario', 'exportador',
    'Decide qué commodity del Anexo I es y, con eso, todo lo demás.'),
  REQ('pais_origen', 'País de producción', 'exportador',
    'Y la región dentro del país cuando el reglamento lo pide.'),
  REQ('geolocalizacion', 'Geolocalización de las parcelas', 'productor',
    'Coordenadas de cada parcela donde se produjo; polígono cuando la parcela supera 4 ha. '
    + 'Es el requisito que no se resuelve con papeles: sin coordenadas no hay EUDR.'),
  REQ('fecha_produccion', 'Fecha o intervalo de producción', 'productor',
    'Tiene que poder contrastarse con la fecha de corte.'),
  REQ('libre_deforestacion', `Libre de deforestación posterior al ${CORTE_DEFORESTACION}`, 'productor',
    'Con información concluyente y verificable, no una declaración suelta.'),
  REQ('legalidad', 'Producción conforme a la legislación del país', 'productor',
    'Tenencia de la tierra, ambiental, laboral, tributaria y derechos de terceros.'),
];

// Lo que pide un comprador cuando no aplica ninguno de los dos regímenes.
// No es un reglamento: es lo mínimo con lo que el dato le sirve, y por eso
// se nombra distinto — decir "cumple X" acá sería inventar una norma.
export const REQUISITOS_EXPORTACION = [
  REQ('pais_origen', 'País de origen', 'exportador',
    'ISO-2. Es lo primero que cruza el comprador con su propio inventario.'),
  REQ('faena_origen', 'Instalación o faena de origen', 'exportador',
    'Sin ella el dato no se puede atribuir a una fuente concreta.'),
  REQ('composicion', 'Composición declarada', 'exportador',
    'Qué es lo que se está exportando, en sus componentes.'),
  REQ('actores', 'Actores de la cadena', 'exportador',
    'Al menos un eslabón registrado: sin actores no hay cadena que mostrar.'),
  REQ('emisiones', 'Emisiones incorporadas por tonelada', 'exportador',
    'Directas, indirectas, o las dos. Basta una para que el comprador tenga con qué partir.'),
];

const REQUISITOS_POR_REGIMEN = {
  eudr: REQUISITOS_EUDR,
  cbam: REQUISITOS_CBAM,
  exportacion: REQUISITOS_EXPORTACION,
};

// Una coordenada declarada, o nada.
//
// El `!= null` de la primera línea NO es defensivo de más: `Number(null)`
// devuelve 0 y `Number.isFinite(0)` es true, así que una parcela con la
// longitud en null habría pasado como geolocalizada **en el meridiano de
// Greenwich** — una coordenada perfectamente válida, en medio del
// Atlántico, para un predio de soya en Mato Grosso. Lo mismo con `''`.
// El rango va incluido porque una latitud de 500 no es un error de tipo:
// es un dato que nadie va a poder contrastar contra una imagen satelital.
function coordenadaValida(v, max) {
  if (v == null || v === '' || typeof v === 'boolean') return false;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max;
}

// ¿Está el campo presente?
//
// EL CERO ES UN VALOR. Un `!lote[campo]` habría tratado una emisión
// declarada en cero como ausencia, que es justo al revés: cero declarado
// es un dato, y borrarlo es peor que no tenerlo. Por eso todo pasa por
// `!= null`.
function presente(lote, campo) {
  switch (campo) {
    case 'codigo_nc': return validarNc(lote?.codigo_nc);
    case 'metodo_emisiones': return METODOS_EMISIONES.includes(lote?.metodo_emisiones);
    case 'composicion': return Boolean(lote?.composicion && Object.keys(lote.composicion).length);
    case 'actores': return Number(lote?.n_eslabones ?? 0) > 0;
    case 'emisiones':
      return lote?.emisiones_directas_tco2e_t != null || lote?.emisiones_indirectas_tco2e_t != null;
    // Una parcela sin coordenadas no es una parcela declarada, y se exige
    // el par completo: media coordenada no ubica nada.
    //
    // Un POLÍGONO también cuenta, y hay que decirlo explícitamente: sobre
    // 4 ha el EUDR exige el perímetro y no admite el punto, así que exigir
    // lat/lng dejaba fuera justo a las parcelas mejor declaradas. Basta
    // con que tenga vértices — de su validez responde validarPoligono() en
    // services/corredor.js, que es quien sabe de polígonos.
    case 'geolocalizacion':
      return Array.isArray(lote?.parcelas) && lote.parcelas.length > 0
        && lote.parcelas.every((p) => {
          const conPunto = coordenadaValida(p?.lat, 90) && coordenadaValida(p?.lng, 180);
          const anillo = p?.poligono?.coordinates?.[0] ?? (Array.isArray(p?.poligono) ? p.poligono : null);
          return conPunto || (Array.isArray(anillo) && anillo.length >= 4);
        });
    // Sí explícito. Un `undefined` o un string no cuentan: "libre de
    // deforestación" es una afirmación que alguien tiene que hacer.
    case 'libre_deforestacion':
    case 'legalidad':
      return lote?.[campo] === true;
    default: {
      const v = lote?.[campo];
      return v != null && String(v).trim() !== '';
    }
  }
}

// Qué regímenes le corresponden a esta carga, y por qué.
//
// Devuelve la lista vacía cuando el código arancelario no está declarado:
// sin él no se sabe, y elegir por defecto es donde se esconde el error
// caro (ver la cabecera). Es una LISTA y no un valor único porque nada
// garantiza que los anexos sigan sin tocarse entre sí.
export function regimenesDe(lote) {
  const nc = lote?.codigo_nc;
  if (!validarNc(nc)) {
    return {
      regimenes: [],
      commodity: null,
      por_que: 'Sin el código arancelario declarado no se puede saber qué régimen aplica. '
        + 'Declararlo es el primer paso, y decide todo lo demás.',
    };
  }

  const regimenes = [];
  const commodity = commodityEudr(nc);
  if (commodity) regimenes.push('eudr');
  if (cbamAplicable(nc)) regimenes.push('cbam');

  if (!regimenes.length) {
    return {
      regimenes: ['exportacion'],
      commodity: null,
      por_que: `El código ${nc} no está ni en el Anexo I del EUDR ni en el de CBAM: esta carga no tiene `
        + 'esas obligaciones. Lo que aplica es lo que pida el comprador para su propio inventario.',
    };
  }

  const partes = [];
  if (commodity) partes.push(`el código ${nc} es ${commodity.etiqueta.toLowerCase()}, del Anexo I del EUDR`);
  if (cbamAplicable(nc)) partes.push(`el código ${nc} está en el Anexo I de CBAM`);
  return { regimenes, commodity: commodity?.commodity ?? null, por_que: `${partes.join('; y ')}.` };
}

function bloqueDe(regimen, lote) {
  const requisitos = REQUISITOS_POR_REGIMEN[regimen].map((r) => ({ ...r, cumplido: presente(lote, r.campo) }));
  const faltantes = requisitos.filter((r) => !r.cumplido).map((r) => r.campo);
  return {
    regimen,
    consecuencia: CONSECUENCIA[regimen],
    requisitos,
    faltantes,
    listo: faltantes.length === 0,
    cumplidos: requisitos.length - faltantes.length,
    total: requisitos.length,
  };
}

// El estado completo: qué regímenes aplican, qué falta en cada uno, quién
// lo aporta y qué pasa si no llega.
//
// `listo` es null —no false— cuando no hay régimen determinado. Decir "no
// está listo" exige saber contra qué; sin eso es una opinión sin base.
export function listoParaExportar(lote) {
  const { regimenes, commodity, por_que } = regimenesDe(lote);

  if (!regimenes.length) {
    // El único requisito afirmable sin saber el régimen es justamente el
    // que falta para saberlo. Listar los de CBAM o los del EUDR acá sería
    // pedirle datos que su carga quizá no necesita.
    const nc = REQUISITOS_CBAM.find((r) => r.campo === 'codigo_nc');
    return {
      regimenes: [], commodity: null, por_que,
      listo: null,
      bloques: [{
        regimen: null, consecuencia: null,
        requisitos: [{ ...nc, cumplido: false }], faltantes: [nc.campo],
        listo: false, cumplidos: 0, total: 1,
      }],
      faltantes_total: 1,
    };
  }

  const bloques = regimenes.map((r) => bloqueDe(r, lote));
  return {
    regimenes,
    commodity,
    por_que,
    listo: bloques.every((b) => b.listo),
    bloques,
    faltantes_total: bloques.reduce((n, b) => n + b.faltantes.length, 0),
  };
}

// Semáforo, con el mismo vocabulario del resto del proyecto
// (semaforoDocumental en pasaporteOrigen.js, semaforoExpediente en
// expediente.js): gris NO es rojo. Gris es «no se opina».
export function semaforoExportacion(estado) {
  if (!estado || estado.listo === null) return 'gris';
  if (estado.listo) return 'verde';
  const cumplidos = (estado.bloques || []).reduce((n, b) => n + b.cumplidos, 0);
  return cumplidos === 0 ? 'rojo' : 'amarillo';
}

// Lo que hay que atender primero. Una prohibición de entrada gana a un
// sobrecosto: no es lo mismo "te va a costar más" que "no vas a poder
// vender", y la pantalla no puede mostrarlos con el mismo peso.
export function urgenciaExportacion(estado) {
  const pendientes = (estado?.bloques || []).filter((b) => !b.listo && b.consecuencia);
  if (!pendientes.length) return null;
  return pendientes.find((b) => b.consecuencia.tipo === 'prohibicion')
    || pendientes.find((b) => b.consecuencia.tipo === 'sobrecosto')
    || pendientes[0];
}

// Frase corta para la pantalla y el PDF. Vive junto a la lógica para que
// no se pueda cambiar el criterio sin cambiar el texto.
export function glosaExportacion(estado) {
  if (!estado || estado.listo === null) {
    return 'Falta declarar el código arancelario para saber qué régimen aplica.';
  }
  const nombre = { eudr: 'EUDR', cbam: 'CBAM', exportacion: 'el comprador' };
  const etiquetas = estado.regimenes.map((r) => nombre[r]).join(' y ');
  if (estado.listo) return `Con todo lo que exige ${etiquetas}.`;
  const n = estado.faltantes_total;
  return `Faltan ${n} ${n === 1 ? 'dato' : 'datos'} de los que exige ${etiquetas}.`;
}
