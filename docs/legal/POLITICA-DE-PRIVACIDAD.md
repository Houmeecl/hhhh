# Política de Privacidad y Tratamiento de Datos — sicr3p

> **BORRADOR PARA REVISIÓN LEGAL — NO PUBLICAR SIN ABOGADO.**
> Preparado sobre la Ley 19.628 y la Ley 21.719 (vigencia diciembre 2026).
> Los puntos marcados `[REVISAR ABOGADO]` requieren decisión o validación jurídica.

**Responsable del tratamiento:** sicr3p SpA, Antofagasta, Chile · contacto@sicr3p.cl
**Última actualización:** [FECHA AL PUBLICAR]

---

## 1. Qué hace la plataforma con datos, en una frase

sicr3p convierte documentos tributarios de empresas en contabilidad de carbono
trazable. Para eso trata datos **de empresas** (la regla) y, en casos acotados,
datos **personales** (la excepción, detallada abajo).

## 2. Qué datos se tratan

### 2.1 Datos de empresas (personas jurídicas)
- RUT de empresa, razón social, documentos tributarios cargados (facturas XML,
  PDF o fotos) y sus ítems: glosas, cantidades, unidades y montos.
- Resultados calculados: t CO2e por documento e ítem, categoría, alcance GHG.
- Declaraciones de embalaje (REP): materiales, pesos, reciclabilidad.
- Los datos de personas jurídicas están, por regla general, fuera del ámbito
  de la Ley 19.628 / Ley 21.719. Aun así, sicr3p les aplica las mismas
  medidas de seguridad que a los datos personales.

### 2.2 Datos personales (personas naturales)
- **Correo electrónico de contacto** de quien carga documentos o solicita
  acceso (magic link).
- **RUT de empresarios persona natural**: cuando un RUT tributario
  corresponde a una persona natural (empresario individual), ese RUT y los
  datos del documento asociados SÍ son datos personales y esta política les
  aplica íntegramente. `[REVISAR ABOGADO: tratamiento diferenciado]`
- Credenciales de operadores del panel (correo, contraseña con hash robusto).
- Log de actividad administrativa (quién hizo qué, con IP), con fines de
  seguridad y auditoría.

### 2.3 Lo que sicr3p NO trata
- Datos sensibles (salud, biometría, etc.): no se solicitan ni se usan.
- Datos de consumidores finales: la plataforma es entre empresas.

## 3. El cruce de datos entre empresas (punto central)

La trazabilidad es la función de la plataforma, y se hace así:

| Cruce | Qué se cruza | Quién lo ve |
|---|---|---|
| **Trazabilidad comprador-vendedor** | El RUT emisor y el RUT receptor de cada documento cargado se indexan para reconstruir cadenas de suministro | Solo el administrador de sicr3p y, respecto de SUS documentos, cada cliente |
| **Acceso de mandantes** | Una empresa mandante con clave de API puede consultar las sesiones de sus proveedores | Solo si el proveedor cargó documentos en la plataforma; el mandante puede además restringirse a una lista blanca de RUTs de proveedores autorizados |
| **Buscador unificado** | Búsqueda por RUT con cruces entre documentos, sesiones, inventario y transporte | Solo operadores autenticados del panel |
| **Superficies públicas** | Verificador QR, cadena de integridad, sello | **Anonimizadas**: nunca muestran RUT, razón social ni folios — solo fechas, toneladas y códigos de verificación |

**Base de licitud** `[REVISAR ABOGADO]`: ejecución del servicio contratado
(la trazabilidad ES el servicio) e interés legítimo en la integridad de la
cadena de suministro; para RUTs de personas naturales, evaluar si se requiere
consentimiento expreso adicional en el flujo de carga.

## 4. Con quién se comparten datos

| Destinatario | Qué recibe | Condición |
|---|---|---|
| **Motor externo de cálculo** (mientras esté activo) | Documentos que el motor propio no logra leer localmente | Solo si `MOTOR_EXTERNO` está activo; el plan vigente es eliminarlo (el motor propio ya cubre XML, PDF, escaneados y fotos). `[REVISAR ABOGADO: mencionar al proveedor por nombre y su política]` |
| **Resend** (correo transaccional) | Dirección de correo y el informe adjunto | Para enviar informes y enlaces de acceso |
| **Proveedores de infraestructura** (VPS, base de datos) | Alojamiento cifrado de los datos | Contratos de hosting estándar `[REVISAR ABOGADO: identificarlos]` |
| **BigQuery (Google)** | Export analítico de lo procesado | SOLO si el administrador lo activa expresamente; apagado por defecto |
| **Empresas mandantes** | Datos de sesiones de sus proveedores | Según la sección 3 |

sicr3p **no vende datos** ni los cede para publicidad.

## 5. Seguridad

- Cifrado en tránsito (HTTPS) y contraseñas con hash robusto (bcrypt).
- Tokens de acceso de corta duración + tokens de renovación.
- Terminales POS autenticados individualmente (serial + clave); montos y
  niveles calculados SIEMPRE en el servidor.
- Cadena de integridad: cada documento queda encadenado con hash SHA-256;
  la alteración de un registro histórico es detectable públicamente.
- Registro de actividad administrativa con IP para auditoría.

## 6. Retención y supresión

- **Documentos en cola de revisión**: el archivo original se retiene SOLO
  hasta que un operador confirma la revisión; al confirmar, se elimina
  automáticamente (minimización por diseño).
- **Datos de sesiones y cálculos**: se conservan mientras el servicio esté
  vigente, porque son el historial trazable del cliente. `[REVISAR ABOGADO:
  plazo máximo y política de eliminación a solicitud]`
- **Particularidad técnica honesta**: la cadena de integridad almacena
  resúmenes criptográficos (hashes) de los documentos. Un hash no permite
  reconstruir el documento ni identifica por sí solo a una persona, pero es
  inmutable por diseño: la supresión de un registro elimina sus datos
  legibles, no su hash histórico. `[REVISAR ABOGADO: redacción frente al
  derecho de supresión de la Ley 21.719]`

## 7. Derechos de los titulares

Para RUTs de personas naturales y datos de contacto: acceso, rectificación,
supresión, oposición y portabilidad (esta última desde la vigencia de la Ley
21.719), escribiendo a **contacto@sicr3p.cl**. Plazo de respuesta:
`[REVISAR ABOGADO: fijar plazo conforme a la 21.719]`.

## 8. Transferencias internacionales

`[REVISAR ABOGADO]` Si la base de datos o el correo transaccional se alojan
fuera de Chile (p. ej. Neon/Resend en EE. UU.), declarar la transferencia y
su salvaguarda conforme a la Ley 21.719.

## 9. Cambios a esta política

Se publicarán en esta misma página con fecha de actualización; los cambios
sustantivos se avisarán al correo de contacto registrado.
