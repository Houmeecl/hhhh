-- ============================================================
-- 106: El DATO trazable — la unidad de registro deja de ser el documento.
--
-- POR QUÉ EXISTE ESTA TABLA. La migración 105 modela documentos: qué
-- factura, qué guía, qué ficha respaldan una venta. Pero el dato que
-- importa no es el documento, es la CANTIDAD:
--
--     «50 filtros industriales correspondientes a la OC 12345 y factura 1234»
--
-- 50 es el dato. La factura es su respaldo. Hasta acá el 50 no existía en
-- ninguna parte del esquema: se quedaba dentro del PDF. Sin el dato como
-- fila propia no hay dónde colgar el nivel de confianza, no hay contra qué
-- correr la consistencia, no hay nada que el cliente pueda llevarse a su
-- sistema de cálculo, y —lo que más pesa— el acuse de recepción en faena
-- no tiene con qué comparar la cantidad recibida.
--
-- LO QUE ESTO SIGUE SIN SER. Un dato respaldado y trazable NO es un dato
-- garantizado como verdadero. sicr3p demuestra procedencia, integridad,
-- consistencia y validación en fuente; la veracidad de lo declarado
-- responde a quien lo declaró — proveedor, fabricante, transportista — y,
-- en su caso, al auditor que lo revise.
--
-- AGUAS ARRIBA Y AGUAS ABAJO. Hasta la 105 solo existía "lo que la empresa
-- compra". `direccion` abre el otro lado: lo que la empresa vende y lo que
-- pasa después (transporte posterior, procesamiento, uso, fin de vida) —
-- las categorías 9 a 12 del GHG Protocol, que ya estaban NOMBRADAS en
-- services/alcanceGhg.js pero no tenían dónde vivir.
-- ============================================================

CREATE TABLE IF NOT EXISTS datos_trazables (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expediente_id  UUID NOT NULL REFERENCES expedientes(id) ON DELETE CASCADE,

  -- Dónde cae este dato en la cadena de valor de la empresa que lo declara.
  -- 'arriba' = lo que compró para poder vender (insumos, combustible,
  -- transporte contratado, subcontratos). 'abajo' = lo que vendió y lo que
  -- ocurre después con eso.
  direccion      TEXT NOT NULL CHECK (direccion IN ('arriba', 'abajo')),

  -- Quién es el actor de este eslabón, visto desde la empresa que declara.
  -- Deja el esquema listo para encadenar tramos entre empresas SIN
  -- prometer que eso ya ocurre: hoy cada proveedor arma solo su tramo, y
  -- unir el del subproveedor con el suyo exige que ambos estén en sicr3p
  -- Y que el de más arriba lo autorice — o sea, divulgación selectiva y
  -- contrato de encargo, que todavía no existen.
  eslabon        TEXT NOT NULL DEFAULT 'proveedor'
                   CHECK (eslabon IN ('subproveedor', 'proveedor', 'cliente', 'cliente_final')),

  -- Etapa aguas abajo. Solo aplica con direccion='abajo', y es la que
  -- decide la categoría: el mismo cátodo cae en la 9 mientras lo
  -- transportan y en la 10 cuando lo funden. NULL aguas arriba, donde la
  -- categoría la decide el tipo de la venta.
  etapa          TEXT,   -- CHECK nombrado más abajo, junto al ALTER que lo defiende

  producto       TEXT NOT NULL,
  cantidad       NUMERIC(18,4) NOT NULL CHECK (cantidad > 0),
  unidad         TEXT NOT NULL,

  -- Categoría de Alcance 3 que le CORRESPONDERÍA al cliente. La palabra
  -- 'potencial' va en el nombre de la columna a propósito, no solo en el
  -- copy de la pantalla: sicr3p no conoce el límite organizacional del
  -- cliente, ni su año base, ni si ya contabilizó esto por otra vía. Un
  -- nombre como `categoria_scope` invitaría a leerlo como definitivo.
  -- 1..15 = las quince del GHG Protocol (CATEGORIAS_ALCANCE3_GHG_PROTOCOL).
  categoria_scope_potencial SMALLINT
                   CHECK (categoria_scope_potencial BETWEEN 1 AND 15),

  -- ---------- Nivel de confianza: 1..5, y quién otorga cada uno ----------
  --  1 Declarado             — lo escribió el proveedor. Lo otorga el proveedor.
  --  2 Documentado           — hay DTE, guía, certificado o contrato detrás.
  --                            Lo otorga el sistema al engancharse un documento.
  --  3 Consistente           — los documentos relacionados COINCIDEN. Lo otorga
  --                            verificarConsistencia(), nunca una persona.
  --  4 Validado en fuente    — contrastado contra SII, ERP, mandante o
  --                            certificador. Lo otorga la fuente, y queda con
  --                            validado_por y validado_at (ver CHECK abajo).
  --  5 Revisado externamente — un auditor independiente lo revisó.
  --
  -- EL 5 ESTÁ EN EL CHECK PERO EL CÓDIGO NO LO EMITE. Necesita un rol de
  -- auditor que hoy no existe, y devolver un 5 sin ese rol sería declarar
  -- una revisión que nadie hizo. El valor se admite para que el día que
  -- exista el rol no haya que migrar datos; hasta entonces, ninguna ruta
  -- ni servicio lo escribe (hay un test que lo exige).
  nivel_confianza SMALLINT NOT NULL DEFAULT 1
                   CHECK (nivel_confianza BETWEEN 1 AND 5),

  -- Resultado de verificarConsistencia(). NULL = todavía no se evaluó
  -- (no hay documentos suficientes para comparar) — que NO es lo mismo que
  -- false ("se comparó y no coinciden"), el mismo criterio con que la
  -- cobertura documental distingue el gris del rojo.
  consistente    BOOLEAN,
  -- [{campo, valores:[...], documentos:[...]}]. Un desacuerdo se REGISTRA,
  -- no se corrige: mismo criterio que balanceMasas con la merma
  -- (pasaporteOrigen.js), que advierte y nunca bloquea. Si la factura dice
  -- 50 y la guía dice 48, el hallazgo es el dato valioso — esconderlo
  -- eligiendo un número sería inventar evidencia.
  desacuerdos    JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Quién validó en fuente y contra qué. `validado_por` es el nombre o
  -- cargo de la persona responsable de la revisión, no un dato de contacto.
  validado_por    TEXT,
  validado_fuente TEXT CHECK (validado_fuente IN ('sii', 'erp', 'mandante', 'certificador')),
  validado_at     TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- El nivel 4 dice "alguien lo contrastó contra una fuente autorizada".
  -- Sin registrar quién, contra qué y cuándo, esa afirmación no es
  -- verificable y el nivel sería una etiqueta vacía. El CHECK lo hace
  -- imposible a nivel de esquema, no solo de aplicación.
  CONSTRAINT datos_trazables_nivel4_exige_validador CHECK (
    nivel_confianza < 4
    OR (validado_por IS NOT NULL AND validado_fuente IS NOT NULL AND validado_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_datos_trazables_exp ON datos_trazables (expediente_id);
CREATE INDEX IF NOT EXISTS idx_datos_trazables_direccion
  ON datos_trazables (expediente_id, direccion);

-- ============================================================
-- Un documento respalda UN DATO, no un expediente suelto.
--
-- Nullable a propósito: la factura de venta (rol 'venta_principal') es del
-- expediente completo, no de una cantidad en particular, y un documento
-- puede engancharse antes de que exista el dato que respaldará.
-- ON DELETE SET NULL: borrar un dato suelta sus respaldos, nunca los borra
-- — el documento sigue siendo parte del expediente.
-- ============================================================
-- Mismo motivo que en la 105: CREATE TABLE IF NOT EXISTS no toca una tabla
-- que ya existe, así que las columnas agregadas a `datos_trazables` después
-- del primer arranque van explícitas o no llegan nunca.
ALTER TABLE datos_trazables ADD COLUMN IF NOT EXISTS etapa TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'datos_trazables_etapa_chk') THEN
    ALTER TABLE datos_trazables ADD CONSTRAINT datos_trazables_etapa_chk
      CHECK (etapa IS NULL OR etapa IN ('transporte_posterior','procesamiento','uso','fin_de_vida'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'datos_trazables_etapa_solo_abajo') THEN
    ALTER TABLE datos_trazables ADD CONSTRAINT datos_trazables_etapa_solo_abajo
      CHECK (etapa IS NULL OR direccion = 'abajo');
  END IF;
END $$;

ALTER TABLE expediente_documentos
  ADD COLUMN IF NOT EXISTS dato_id UUID REFERENCES datos_trazables(id) ON DELETE SET NULL;

-- Lo que ESTE documento dice de la cantidad, que puede no ser lo que dice
-- el de al lado. Es el insumo de verificarConsistencia(): sin la cantidad
-- por documento no hay nada que comparar, y "los documentos relacionados
-- coinciden" (el nivel 3) sería una afirmación sin evidencia detrás.
-- Opcionales: un certificado o una ficha técnica no declaran cantidad.
ALTER TABLE expediente_documentos ADD COLUMN IF NOT EXISTS cantidad NUMERIC(18,4);
ALTER TABLE expediente_documentos ADD COLUMN IF NOT EXISTS unidad   TEXT;

CREATE INDEX IF NOT EXISTS idx_expediente_documentos_dato
  ON expediente_documentos (dato_id) WHERE dato_id IS NOT NULL;

-- ============================================================
-- Historial de modificaciones — append-only.
--
-- Del registro mínimo de cada dato: poder responder "quién cambió esta
-- cantidad y cuándo". NO es una cadena de hash (esa vive en `facturas` y
-- en `lote_eslabones`); es una bitácora, con el mismo alcance y las mismas
-- limitaciones que `actividad_log`.
--
-- `usuario_id` con ON DELETE SET NULL por la misma razón que actividad_log:
-- el derecho de supresión de una persona no puede quedar bloqueado por una
-- bitácora, y el hecho registrado sobrevive aunque el autor se borre.
-- ============================================================
CREATE TABLE IF NOT EXISTS datos_trazables_historial (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dato_id        UUID NOT NULL REFERENCES datos_trazables(id) ON DELETE CASCADE,
  campo          TEXT NOT NULL,
  valor_anterior TEXT,
  valor_nuevo    TEXT,
  usuario_id     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_datos_trazables_historial_dato
  ON datos_trazables_historial (dato_id, created_at);
