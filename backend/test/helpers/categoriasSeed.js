// ============================================================
// Definición ÚNICA en memoria del seed de motor_categorias tal como
// queda una BD recién migrada (010 + 018 + 026 + 031). La usa
// motorSeedParidad.test.js, que re-deriva este mismo estado leyendo
// el SQL de las migraciones y compara campo a campo: si alguien
// cambia un factor o una keyword en el seed sin actualizar aquí (o
// al revés), la suite truena sin necesidad de BD.
//
// Convenciones:
//  - palabras_clave es el conjunto FINAL (tras los traspasos de la
//    018 —glp fuera de combustible— y los sinónimos de la 026/031).
//  - activo refleja la 031 (la categoría 'agua' legada queda apagada).
//  - Solo los campos que participan del cálculo/clasificación; la
//    fuente textual y las FKs se auditan en higieneMetodologica.test.js.
// ============================================================

const SEED = [
  // ---- 010 (base) ----
  {
    codigo: 'electricidad', nombre: 'Energía eléctrica', unidad_fisica: 'kWh',
    factor_fisico_kgco2e: 0.2421, factor_gasto_kgco2e_clp1000: 0.60, activo: true,
    palabras_clave: [
      'electric', 'kwh', 'energia', 'suministro electrico', 'sen', 'luz', 'potencia',
      // 026
      'enel', 'cge', 'chilquinta', 'saesa', 'frontel', 'boleta de luz', 'cuenta de luz',
    ],
  },
  {
    codigo: 'combustible', nombre: 'Combustibles', unidad_fisica: 'L',
    factor_fisico_kgco2e: 2.68, factor_gasto_kgco2e_clp1000: 1.20, activo: true,
    palabras_clave: [
      // 010 sin 'glp' ni 'gas licuado' (la 018 los traslada a la categoría glp)
      'diesel', 'diésel', 'gasolina', 'bencina', 'combustible', 'petroleo',
      // 026
      'copec', 'shell', 'petrobras', 'terpel', 'diesel b5', '95 octanos', '97 octanos', '93 octanos',
    ],
  },
  {
    codigo: 'transporte', nombre: 'Transporte y logística', unidad_fisica: 'km',
    factor_fisico_kgco2e: 0.12, factor_gasto_kgco2e_clp1000: 0.35, activo: true,
    palabras_clave: [
      'flete', 'transporte', 'distribucion', 'distribución', 'logistica', 'logística',
      'envio', 'envío', 'courier', 'despacho',
      // 026
      'starken', 'chilexpress', 'blue express', 'correos de chile', 'flete terrestre',
    ],
  },
  {
    codigo: 'materiales', nombre: 'Insumos y materiales', unidad_fisica: 'kg',
    factor_fisico_kgco2e: 1.5, factor_gasto_kgco2e_clp1000: 0.45, activo: true,
    palabras_clave: [
      'papeleria', 'papelería', 'envase', 'repuesto', 'insumo', 'material', 'embalaje', 'toner',
      // 026
      'consumibles de oficina', 'cartucho de tinta', 'resma de papel',
    ],
  },
  {
    // Legada — la 031 la desactiva a favor de agua_potable (DEFRA 2024).
    codigo: 'agua', nombre: 'Agua', unidad_fisica: 'm3',
    factor_fisico_kgco2e: 0.344, factor_gasto_kgco2e_clp1000: 0.30, activo: false,
    palabras_clave: ['agua', 'hidrico', 'hídrico', 'potable', 'sanitario'],
  },
  {
    codigo: 'servicios', nombre: 'Servicios', unidad_fisica: null,
    factor_fisico_kgco2e: null, factor_gasto_kgco2e_clp1000: 0.25, activo: true,
    palabras_clave: [
      'servicio', 'aseo', 'mantencion', 'mantención', 'arriendo', 'asesoria', 'asesoría', 'honorario',
      // 026
      'mantenimiento', 'limpieza', 'consultoria', 'consultoría',
    ],
  },

  // ---- 018 (metodologías avaladas) ----
  {
    codigo: 'gas_natural', nombre: 'Gas natural', unidad_fisica: 'm3',
    factor_fisico_kgco2e: 2.02, factor_gasto_kgco2e_clp1000: 0.90, activo: true,
    palabras_clave: ['gas natural', 'metrogas', 'gas de red', 'gnl'],
  },
  {
    codigo: 'glp', nombre: 'Gas licuado (GLP)', unidad_fisica: 'L',
    factor_fisico_kgco2e: 1.61, factor_gasto_kgco2e_clp1000: 1.00, activo: true,
    palabras_clave: [
      'glp', 'gas licuado', 'lipigas', 'abastible', 'gasco', 'cilindro de gas', 'balon de gas',
      // 026
      'garrafa', 'gas licuado de petroleo',
    ],
  },
  {
    codigo: 'kerosene_jet', nombre: 'Kerosene / Jet A-1', unidad_fisica: 'L',
    factor_fisico_kgco2e: 2.54, factor_gasto_kgco2e_clp1000: 1.10, activo: true,
    palabras_clave: ['kerosene', 'kerosen', 'parafina', 'jet a1', 'jet a-1', 'combustible de aviacion'],
  },
  {
    codigo: 'refrigerante_r134a', nombre: 'Refrigerante R-134a (fuga)', unidad_fisica: 'kg',
    factor_fisico_kgco2e: 1530, factor_gasto_kgco2e_clp1000: 25.0, activo: true,
    palabras_clave: ['r-134a', 'r134a', 'hfc-134a', 'refrigerante 134'],
  },
  {
    codigo: 'refrigerante_r410a', nombre: 'Refrigerante R-410A (fuga)', unidad_fisica: 'kg',
    factor_fisico_kgco2e: 2256, factor_gasto_kgco2e_clp1000: 35.0, activo: true,
    palabras_clave: ['r-410a', 'r410a', 'refrigerante 410'],
  },
  {
    codigo: 'residuos_relleno', nombre: 'Residuos a relleno sanitario', unidad_fisica: 'kg',
    factor_fisico_kgco2e: 0.45, factor_gasto_kgco2e_clp1000: 0.50, activo: true,
    palabras_clave: ['relleno sanitario', 'disposicion final', 'retiro de residuos', 'residuos', 'vertedero', 'basura'],
  },
  {
    codigo: 'agua_potable', nombre: 'Agua potable (red)', unidad_fisica: 'm3',
    factor_fisico_kgco2e: 0.41, factor_gasto_kgco2e_clp1000: 0.30, activo: true,
    palabras_clave: [
      'agua potable', 'aguas andinas', 'esval', 'essbio', 'smapa',
      // 026
      'nuevosur', 'essal', 'aguas del valle',
      // 031 (traspaso desde la categoría agua legada)
      'agua', 'hidrico', 'hídrico', 'potable', 'sanitario',
    ],
  },
  {
    codigo: 'vuelo_corto', nombre: 'Vuelo corto (pasajero)', unidad_fisica: 'km',
    factor_fisico_kgco2e: 0.15, factor_gasto_kgco2e_clp1000: 0.70, activo: true,
    palabras_clave: ['vuelo', 'pasaje aereo', 'vuelo nacional', 'vuelo domestico', 'aereo nacional'],
  },
  {
    codigo: 'vuelo_largo', nombre: 'Vuelo largo (pasajero)', unidad_fisica: 'km',
    factor_fisico_kgco2e: 0.19, factor_gasto_kgco2e_clp1000: 0.60, activo: true,
    palabras_clave: ['vuelo internacional', 'pasaje aereo internacional', 'flete aereo', 'aereo internacional', 'vuelo largo'],
  },
  {
    // t-km deliberadamente FUERA de normalizarUnidad: gasto-only por diseño.
    codigo: 'maritimo_contenedor', nombre: 'Marítimo — contenedor', unidad_fisica: 't-km',
    factor_fisico_kgco2e: 0.012, factor_gasto_kgco2e_clp1000: 0.20, activo: true,
    palabras_clave: ['flete maritimo', 'maritimo', 'naviera', 'contenedor', 'embarque maritimo'],
  },
];

// Map con el mismo shape que motorPropio.cargarCategorias (fila por codigo).
export function categoriasSeed() {
  return new Map(SEED.map((c) => [c.codigo, { ...c, palabras_clave: [...c.palabras_clave] }]));
}
