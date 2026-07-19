-- ============================================================
-- sicr3p — Compensaciones del POS "Aduana Verde" + tarifa configurable.
--
-- config_pos: configuración única del POS (fila 1 forzada por CHECK).
-- La tarifa parte en $5.000 CLP por t CO2e como REFERENCIA (ancla del
-- impuesto verde chileno, US$5/t CO2e) y el admin puede ajustarla desde
-- el panel (PUT /api/admin/pos/config).
--
-- compensaciones: registro del cobro (o de la decisión de no cobrar)
-- por cada trámite del POS. El monto SIEMPRE se calcula en el servidor:
-- t CO2e de la sesión × tarifa vigente, redondeado a pesos enteros.
-- Una compensación por sesión: un re-cobro del mismo trámite reemplaza
-- la anterior (UNIQUE(sesion_id) + ON CONFLICT DO UPDATE).
-- Estados: hoy solo se usan 'simulado' (pago simulado, sin pasarela) y
-- 'omitido' (el operador decidió no cobrar, monto $0); 'pendiente' y
-- 'pagado' quedan listos para la pasarela real (VirtualPos).
-- ============================================================

CREATE TABLE IF NOT EXISTS config_pos (
  id               INT PRIMARY KEY CHECK (id = 1),  -- fila única de configuración
  tarifa_clp_tco2e NUMERIC NOT NULL DEFAULT 5000,   -- CLP por t CO2e
  fuente           TEXT,                            -- de dónde sale la tarifa (trazabilidad)
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Tarifa inicial referencial; si la fila ya existe no se toca.
INSERT INTO config_pos (id, tarifa_clp_tco2e, fuente)
VALUES (1, 5000, 'Referencial — ancla impuesto verde chileno (US$5/t CO2e). Validar tarifa comercial.')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS compensaciones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id        UUID NOT NULL UNIQUE REFERENCES sesiones(id) ON DELETE CASCADE,
  terminal_id      UUID REFERENCES pos_terminales(id) ON DELETE SET NULL,
  t_co2e           NUMERIC NOT NULL,   -- toneladas de la sesión al momento del cobro
  tarifa_clp_tco2e NUMERIC NOT NULL,   -- tarifa vigente aplicada (queda congelada acá)
  monto_clp        NUMERIC NOT NULL,   -- ROUND(t_co2e × tarifa); 0 si estado 'omitido'
  metodo           TEXT,               -- ej: 'tarjeta', 'efectivo' (informativo)
  estado           TEXT NOT NULL CHECK (estado IN ('simulado','omitido','pendiente','pagado')),
  created_at       TIMESTAMPTZ DEFAULT now()
);
