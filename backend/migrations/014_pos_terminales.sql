-- ============================================================
-- sicr3p — Terminales físicos de la red "Aduana Verde" (oficinas).
-- El terminal se autentica como DISPOSITIVO (serial + clave), no como
-- persona — patrón VecinoXpress/NotaryPro (pos_devices).
-- La clave solo se guarda hasheada (bcrypt); se muestra UNA vez al crear
-- o regenerar. El serial es corto y legible (AV-XXXX) para pegarlo
-- físicamente en el equipo.
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_terminales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,                          -- nombre visible del terminal (ej: "Oficina Los Andes 1")
  ubicacion TEXT,                                -- dirección u oficina donde está instalado
  serial TEXT NOT NULL UNIQUE,                   -- identificador corto AV-XXXX (hex mayúsculas)
  clave_hash TEXT NOT NULL,                      -- bcrypt de la clave del dispositivo (nunca en claro)
  activo BOOLEAN NOT NULL DEFAULT true,          -- un terminal inactivo no puede autenticarse
  ultima_actividad TIMESTAMPTZ,                  -- último login o documento procesado
  documentos_procesados INT NOT NULL DEFAULT 0,  -- contador acumulado de documentos del terminal
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
