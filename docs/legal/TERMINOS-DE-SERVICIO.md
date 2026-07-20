# Términos de Servicio — sicr3p

> **BORRADOR PARA REVISIÓN LEGAL — NO PUBLICAR SIN ABOGADO.**
> Los puntos `[REVISAR ABOGADO]` requieren decisión o validación jurídica.

**Prestador:** sicr3p SpA, Antofagasta, Chile · contacto@sicr3p.cl
**Última actualización:** [FECHA AL PUBLICAR]

---

## 1. Qué es el servicio

sicr3p es una plataforma de **contabilidad de carbono trazable**: procesa
documentos tributarios que el cliente carga (XML DTE, PDF, fotos), calcula
emisiones de CO2 equivalente con metodología del GHG Protocol y factores de
emisión con fuente citada, y entrega informes, etiquetas QR verificables,
sellos digitales y trazabilidad encadenada. Incluye la red de oficinas
físicas "Aduana Verde" (tramitación presencial con terminal POS) y la
captura de declaraciones de embalaje para la gestión REP (Ley 20.920).

## 2. Qué NO es el servicio (aceptación expresa del cliente)

El cliente entiende y acepta que sicr3p:

1. **No emite certificaciones acreditadas.** Los informes constituyen
   contabilidad trazable; NO son una verificación de tercera parte
   acreditada (ISO 14064-3) ni un certificado oficial.
2. **No es un organismo público** ni actúa ante el Servicio Nacional de
   Aduanas; "Aduana Verde" es una marca privada de tramitación verde de
   documentos comerciales.
3. **No es un sistema de gestión REP** ni presenta declaraciones oficiales
   ante el Ministerio del Medio Ambiente a nombre del cliente; entrega el
   dato ordenado y trazable para que el cliente cumpla sus obligaciones.
4. **No emite bonos de carbono** ni garantiza que la compensación voluntaria
   registrada constituya un instrumento transable.
5. **Entrega estimaciones metodológicas**: los cálculos aplican factores de
   emisión referenciales con fuente citada sobre los datos reales de los
   documentos; no son mediciones instrumentales.

## 3. Modelo de cobro

- sicr3p cobra por la **gestión**: procesamiento, cálculo, trazabilidad,
  informes y verificación. `[REVISAR ABOGADO/COMERCIAL: precios y plan]`
- La **compensación de CO2 es voluntaria**, con tarifa referencial visible
  (anclada al impuesto verde chileno, US$5/t) y NO es requisito para recibir
  ningún informe. La decisión de no compensar queda registrada con la misma
  validez.
- En la Ley REP, el costo del servicio es la gestión del dato; las tarifas
  de sistemas de gestión y obligaciones legales del productor son del
  cliente.

## 4. Datos del cliente y cruces entre empresas

1. El cliente autoriza el tratamiento de los documentos que carga conforme a
   la **Política de Privacidad** (parte integrante de estos términos).
2. El cliente entiende que la **trazabilidad comprador-vendedor por RUT es
   una función esencial** del servicio: los RUT emisor/receptor de sus
   documentos se indexan para reconstruir cadenas de suministro.
3. Si el cliente es proveedor de una **empresa mandante** usuaria de la API
   de sicr3p, sus sesiones pueden ser visibles para ese mandante.
   `[REVISAR ABOGADO: consentimiento en el flujo de carga vs. cláusula]`
4. Las superficies públicas (verificador QR, cadena, sello) están
   **anonimizadas**: no exponen RUT, razón social ni folios.
5. El cliente declara tener derecho a cargar los documentos que sube (son
   suyos o cuenta con autorización).

## 5. Cadena de integridad (aceptación expresa)

Cada documento procesado queda **encadenado criptográficamente**. Esto da
verificabilidad, y tiene una consecuencia que el cliente acepta: los
registros históricos encadenados **no pueden editarse ni eliminarse** sin
evidencia pública de la alteración. Las correcciones se hacen mediante
nuevos registros (nunca reescribiendo los anteriores).

## 6. Responsabilidad

`[REVISAR ABOGADO: esta sección completa]`
- El cliente es responsable de la veracidad de los documentos que carga.
- sicr3p responde por la correcta aplicación de la metodología declarada
  sobre esos documentos, hasta un tope de responsabilidad de
  `[DEFINIR: p. ej., lo pagado por el cliente en los últimos 12 meses]`.
- sicr3p no responde por decisiones de terceros (mandantes, bancos,
  reguladores) basadas en los informes, ni por el rechazo de una
  verificación acreditada posterior.
- Disponibilidad objetivo del servicio y ventanas de mantención:
  `[DEFINIR SLA]`.

## 7. Propiedad

- Los documentos y datos cargados son del cliente.
- La plataforma, el motor de cálculo, las marcas sicr3p y Aduana Verde y los
  informes generados (en su formato y diseño) son de sicr3p SpA.
- El cliente puede usar libremente sus informes, etiquetas y sellos,
  incluida su publicación, siempre que no altere su contenido.

## 8. Término

Cualquiera de las partes puede terminar el servicio con aviso de
`[DEFINIR]` días. Al término, el cliente puede solicitar la exportación de
sus datos; la supresión se rige por la Política de Privacidad (incluida la
particularidad de los hashes de la cadena, sección 6 de esa política).

## 9. Ley aplicable y jurisdicción

Ley chilena. Tribunales de `[DEFINIR: Antofagasta / Santiago]`.
`[REVISAR ABOGADO: cláusula de arbitraje si se prefiere]`
