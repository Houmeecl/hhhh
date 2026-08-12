-- ============================================================
-- Corrección de la vigencia de NIIF S1/S2 (NCG 519) con FUENTE PRIMARIA,
-- y alta de la NCG 461 que faltaba en el registro.
--
-- La migración 098 registró la NCG 519 con vigencia 2026-01-01, tomada de
-- una investigación web que decía "obligatorias desde el ejercicio 2026,
-- primer reporte 2027". ERA INCORRECTO, por dos años.
--
-- La fuente primaria es la presentación de Bernardita Piedrabuena,
-- Comisionada de la CMF, del 12-08-2026 ("Avanzando hacia más y mejor
-- información: normas ASG", Pacto Global Chile / PRI / Proyecta Impacto).
-- Dice textual:
--
--   "Para una mejor implementación del estándar de divulgación, se decidió
--    postergar la entrada en vigencia para el año 2028 (información de
--    2027), pero dando la posibilidad de adopción voluntaria en 2027."
--
-- Este episodio es exactamente lo que motivó crear el registro en 098: una
-- regla que se creía vigente y no lo estaba. Que el propio registro haya
-- necesitado corregirse a los pocos días valida el diseño — y deja la
-- lección: número normativo sin fuente primaria es una suposición.
--
-- Ojo con `estado`: la NCG 519 SIGUE vigente como norma (fue publicada y
-- está en vigor). Lo que se postergó es cuándo muerde la obligación de
-- aplicar NIIF S1/S2. Por eso se corrige `fecha_vigencia` y NO el estado:
-- distinguir esas dos cosas es justamente para lo que sirve la tabla.
-- ============================================================

UPDATE fuentes_metodologicas SET
  fecha_vigencia = DATE '2028-01-01',
  notas =
    'OBLIGATORIA a partir de 2028, sobre la información del ejercicio 2027 '
    '(la CMF POSTERGÓ la entrada en vigencia; antes se esperaba para el '
    'ejercicio 2026). Habilita ADOPCIÓN VOLUNTARIA en 2027 sobre el '
    'ejercicio 2026, y la CMF invita a quienes lo hagan a participar en '
    'instancias de retroalimentación técnica — ventana de early adopter '
    'con acceso directo al regulador. '
    'NIIF S2 exige métricas que van más allá del inventario de GEI '
    '(alcances 1, 2 y 3): precios internos de carbono, cantidad y % de '
    'activos vulnerables a riesgos físicos y de transición, despliegue de '
    'capital y remuneración. El cambio de fondo es "de lo cualitativo a lo '
    'cuantitativo" y "del periodo anterior a la proyección". '
    'Universo obligado a reportar en 2026: 232 emisores + 75 bancos, '
    'compañías de seguros, AGF y DCV. '
    'FUENTE PRIMARIA: presentación de Bernardita Piedrabuena, Comisionada '
    'de la CMF, 12-08-2026, "Avanzando hacia más y mejor información: '
    'normas ASG" (Pacto Global Chile / PRI / Proyecta Impacto), lámina 21. '
    'La lámina 14 del mismo documento dice "a contar de la memoria anual '
    'publicada el año 2027" y la tabla de la lámina 19 usa el condicional '
    '("se aplicarían") para 2027: se toma la lámina 21 por ser la más '
    'explícita sobre la postergación, y se deja anotada la discrepancia.'
WHERE codigo = 'ncg_519_cmf';

-- La NCG 461 faltaba, y es la que rige AHORA para los reportantes
-- obligados. Sin ella el registro sugiere que lo único aplicable es la
-- 519 — que no muerde hasta 2028 —, dejando un vacío donde en realidad
-- hay una obligación vigente. Las dos conviven.
INSERT INTO fuentes_metodologicas
  (codigo, tipo, organismo, documento, version_anio, url, estado, fecha_publicacion, fecha_vigencia, notas)
VALUES
  ('ncg_461_cmf', 'norma_legal', 'Comisión para el Mercado Financiero',
   'NCG 461 — Contenido de la memoria anual: información ASG integrada',
   '2021', 'https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-38351.html',
   'vigente', '2021-11-12', '2022-01-01',
   'Es la norma que rige HOY para los reportantes obligados, y convive con '
   'la NCG 519 (NIIF S1/S2, obligatoria recién en 2028). Reestructura la '
   'memoria anual incorporando temáticas ASG de forma integral, alineada a '
   'TCFD, GRI y SASB. Implementación escalonada por tamaño: ejercicio 2022 '
   'para sociedades anónimas abiertas sobre UF 20 millones en activos, '
   'ejercicio 2023 sobre UF 1 millón, ejercicio 2025 para bancos, '
   'aseguradoras, AGF, bolsas y entidades de infraestructura. '
   'Proporcionalidad: los emisores bajo UF 1 millón de activos quedan '
   'exceptuados, y las métricas SASB pueden no informarse justificándolo. '
   'Misma fuente primaria que la NCG 519 (presentación CMF del 12-08-2026, '
   'láminas 10, 12 y 19).')
ON CONFLICT (codigo) DO NOTHING;
