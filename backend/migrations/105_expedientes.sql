-- ============================================================
-- 105: Expediente de evidencia — la venta como carpeta, no como cálculo.
--
-- QUÉ CAMBIA. Hasta acá una factura de venta era una fila con un total de
-- CO2e. El expediente la convierte en la carpeta que la respalda:
--
--   Cliente → OC → factura de venta → compras relacionadas → brechas
--
-- y responde la pregunta que la fila suelta no responde: *¿con qué está
-- respaldado este número, y qué le falta?*
--
-- LO QUE ESTO NO ES. No es contabilidad de carbono del cliente. sicr3p
-- prepara y ordena la evidencia del proveedor; el inventario de la minera
-- lo hace la minera. Por eso la clasificación de alcance que sale de acá
-- se llama POTENCIAL en el nombre del dato, no solo en el copy (ver
-- services/expediente.js: scopePotencial).
--
-- Y sobre todo: una factura acredita una operación documental; NO
-- demuestra por sí sola entrega, uso ni desempeño. El expediente muestra
-- qué documentos existen y cuáles faltan — no opina sobre la realidad
-- física detrás de ellos.
--
-- LA ORDEN DE COMPRA CAMBIA DE PAPEL. Hasta hoy una OC solo aparecía en el
-- código para RECHAZAR un documento: NO_CALCULABLE_RE
-- (services/facturaTexto.js) busca la frase "orden de compra" en los
-- primeros 500 caracteres y descarta el documento si se declara como tal.
-- Ese rechazo sigue siendo correcto — una OC no se calcula. Acá la OC deja
-- de ser un documento y pasa a ser LA CARPETA: el campo que agrupa la venta
-- con todo lo que la sustenta.
--
-- OJO, PARA QUE NADIE LO LEA DE MÁS: hoy `orden_compra` SE ESCRIBE A MANO
-- desde el panel. NINGÚN parser extrae el número de la OC del texto de una
-- factura. facturaTexto.js solo matchea la frase, nunca captura "OC-445", y
-- analisisIA.js la menciona únicamente para instruir al modelo que no use
-- ese tipo de documento. Capturar el número automáticamente es trabajo
-- pendiente, no algo que esta migración habilite.
--
-- GRANULARIDAD. Un expediente = UNA factura de venta ("cada factura de
-- venta abre un expediente"). La OC y el contrato son campos de
-- agrupación, NO claves únicas: una misma OC puede facturarse en partes, y
-- el consolidado por OC se arma leyendo, no restringiendo el esquema.
-- ============================================================

CREATE TABLE IF NOT EXISTS expedientes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,

  -- El cliente del proveedor (la minera). Se guarda el RUT normalizado
  -- —sin puntos ni guión, mismo criterio que proveedores.rut y
  -- dte_proveedor.rut_contraparte— para que el cruce sea por igualdad y
  -- no por LIKE. Puede ser NULL: al abrir el expediente desde una factura
  -- suelta todavía no siempre se sabe.
  cliente_rut     TEXT,
  cliente_nombre  TEXT NOT NULL,

  -- Los tres ejes de agrupación del ejemplo real (OC 12345 / contrato /
  -- faena). NINGUNO es obligatorio: un expediente sin OC sigue siendo un
  -- expediente, solo que no consolida con otros.
  orden_compra    TEXT,
  contrato        TEXT,
  faena           TEXT,
  centro_costo    TEXT,

  periodo         TEXT,   -- 'YYYY-MM' del hecho económico, igual que dte_proveedor.periodo

  -- Qué se vendió, en las palabras del proveedor. No es una categoría del
  -- motor: es la glosa que hace legible el expediente para su cliente.
  glosa           TEXT,

  -- Familia del servicio vendido. Decide qué documentos se ESPERAN y por
  -- lo tanto cuáles faltan (ROLES_ESPERADOS_POR_TIPO en el servicio).
  -- 'otro' existe a propósito: sin esperados definidos el semáforo queda
  -- GRIS ("no se opina"), que es distinto de rojo ("no cumple").
  tipo            TEXT NOT NULL DEFAULT 'otro'
                    CHECK (tipo IN ('suministro','servicio','transporte','arriendo','otro')),

  -- 'borrador' mientras el proveedor arma; 'abierto' cuando ya se puede
  -- mostrar; 'cerrado' cuando el proveedor declara que no agregará más.
  -- Cerrar NO congela nada por sí solo: la inmutabilidad la da la cadena
  -- de hash de los documentos, no este campo.
  estado          TEXT NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador','abierto','cerrado')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expedientes_proveedor ON expedientes (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_expedientes_oc
  ON expedientes (proveedor_id, orden_compra) WHERE orden_compra IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expedientes_cliente
  ON expedientes (cliente_rut) WHERE cliente_rut IS NOT NULL;

-- ============================================================
-- Documentos del expediente.
--
-- ORIGEN DEL DOCUMENTO — tres caminos, y el tercero es el importante:
--   · factura_id        → un DTE ya cargado y encadenado en sicr3p.
--   · dte_proveedor_id  → una línea del RCV que el proveedor ya bajó de
--                         su propio SII (migración 071). El proveedor
--                         arma su expediente con lo que YA tiene: no hay
--                         que volver a subir nada.
--   · ninguno de los dos → un documento que el proveedor DECLARA que
--                         existe pero que sicr3p no tiene. Se registra
--                         igual, y el servicio lo cuenta como nivel 1
--                         (declarado), nunca como respaldo verificado.
--                         Registrar un declarado es mejor que no verlo:
--                         aparece como brecha, que es justamente el punto.
--
-- ASOCIACIÓN — cuánto de este documento corresponde a esta venta:
--   · 'directa'    → íntegramente de esta venta (100%).
--   · 'confirmada' → parcialmente, y el proveedor confirmó la proporción.
--   · 'compartida' → prorrateado entre varias ventas.
-- El porcentaje es OBLIGATORIO salvo en 'directa' (donde es 100 por
-- definición): sin él, "compartida" no significaría nada medible.
-- ============================================================

CREATE TABLE IF NOT EXISTS expediente_documentos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expediente_id      UUID NOT NULL REFERENCES expedientes(id) ON DELETE CASCADE,

  rol                TEXT NOT NULL
                       CHECK (rol IN ('venta_principal','compra_relacionada','guia',
                                      'certificado','ficha_tecnica','orden_compra','otro')),

  asociacion         TEXT NOT NULL DEFAULT 'directa'
                       CHECK (asociacion IN ('directa','confirmada','compartida')),
  porcentaje         NUMERIC(5,2) NOT NULL DEFAULT 100
                       CHECK (porcentaje > 0 AND porcentaje <= 100),

  factura_id         UUID REFERENCES facturas(id) ON DELETE SET NULL,
  dte_proveedor_id   UUID REFERENCES dte_proveedor(id) ON DELETE SET NULL,

  -- Identidad legible del documento, siempre presente aunque el vínculo
  -- se pierda (ON DELETE SET NULL) o nunca haya existido (declarado).
  descripcion        TEXT NOT NULL,
  emisor_rut         TEXT,
  tipo_dte           SMALLINT,
  folio              TEXT,
  fecha              DATE,
  monto              NUMERIC(14,2),

  -- Cómo se repartió un documento entre varias ventas ("por consumo de
  -- la faena", "por horas máquina", "por superficie"). Obligatorio de
  -- hecho aunque no de esquema: brechasDe() levanta 'prorrateo_sin_base'
  -- cuando falta, porque un 15% sin decir 15% DE QUÉ no se puede
  -- reproducir, y un dato que no se puede reproducir no es evidencia.
  base_prorrateo     TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 'directa' siempre es 100: si alguien guarda 'directa' con 60 estaría
  -- diciendo dos cosas contradictorias en la misma fila.
  CONSTRAINT expediente_documentos_directa_100_chk
    CHECK (asociacion <> 'directa' OR porcentaje = 100)
);

-- CREATE TABLE IF NOT EXISTS no agrega columnas ni constraints a una tabla
-- que YA EXISTE. Como migrate.js corre TODOS los .sql en cada arranque sin
-- registro, una base que alcanzó a crear estas tablas con una versión
-- anterior de este archivo se quedaría sin lo agregado después, para
-- siempre y en silencio.
--
-- Por eso van explícitos TODOS los campos y constraints que no son parte
-- del CREATE original — no solo el último que se agregó. Defender uno solo
-- y decir "ahora es idempotente" sería quedarse tranquilo con media
-- verdad: los otros seguirían faltando igual.
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS centro_costo TEXT;
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS glosa        TEXT;
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE expediente_documentos ADD COLUMN IF NOT EXISTS base_prorrateo TEXT;

-- Los CHECK no tienen "IF NOT EXISTS": se agregan solo si no están.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expediente_documentos_directa_100_chk'
  ) THEN
    ALTER TABLE expediente_documentos
      ADD CONSTRAINT expediente_documentos_directa_100_chk
      CHECK (asociacion <> 'directa' OR porcentaje = 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expediente_documentos_exp
  ON expediente_documentos (expediente_id);

-- Una sola venta principal por expediente. Es la definición misma de
-- "un expediente = una factura de venta": sin esto, el denominador de la
-- cobertura documental sería ambiguo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expediente_venta_principal
  ON expediente_documentos (expediente_id) WHERE rol = 'venta_principal';

-- El mismo DTE no se engancha dos veces al mismo expediente. Índices
-- parciales porque ambos vínculos son opcionales (un documento declarado
-- no tiene ninguno de los dos, y NULL no colisiona con NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_expediente_factura
  ON expediente_documentos (expediente_id, factura_id) WHERE factura_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_expediente_dte_proveedor
  ON expediente_documentos (expediente_id, dte_proveedor_id) WHERE dte_proveedor_id IS NOT NULL;
