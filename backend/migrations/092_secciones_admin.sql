-- ============================================================
-- secciones_admin: qué partes del panel sicrep puede VER y USAR cada
-- cuenta, ortogonal a `rol` (que sigue definiendo si dentro de una
-- sección puede solo leer o también mutar vía requireRole). Mismo patrón
-- de columna con vocabulario cerrado que 027/069/070.
--
-- A diferencia de esas tres columnas, el default para FILAS NUEVAS es
-- deliberadamente vacío ('{}'): esta columna existe para RESTRINGIR, no
-- para extender un acceso que ya existía — un alta que "se olvida" de
-- marcar secciones debe quedar sin nada visible (fail-closed), no con
-- todo. Las cuentas YA EXISTENTES se respaldan con el UPDATE explícito
-- de abajo para no quitarles ninguna capacidad el día del deploy (regla
-- ya usada en 027/070).
--
-- Vocabulario: un slug por cada sección del NAV del panel admin
-- (frontend/src/admin/secciones.js — mantener sincronizados; el espejo
-- backend vive en src/constants/seccionesAdmin.js). 'dashboard' está en
-- el vocabulario pero su ruta backend NO se gatea: toda cuenta necesita
-- un landing tras el login.
-- ============================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS secciones_admin TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'usuarios_secciones_admin_check' AND conrelid = 'usuarios'::regclass
  ) THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_secciones_admin_check
      CHECK (secciones_admin <@ ARRAY[
        'dashboard','enrolar','clientes','sesiones','buscar','metricas','sii',
        'capital_natural','trazabilidad','transporte','corredor','origen',
        'capacitacion','apl','prospectos','auspiciadores','juego',
        'accesos_externos','motor_propio','motor_externo','usuarios','actividad',
        'datos_personales'
      ]::text[]);
  END IF;
END $$;

-- Backfill: las cuentas sicrep ya creadas siguen viendo TODO lo que veían
-- (cero cambio de comportamiento al desplegar). Solo panel='sicrep'
-- importa: los otros paneles no consumen esta columna. El WHERE de
-- secciones vacías hace la migración re-ejecutable sin pisar una
-- restricción que un admin ya haya configurado a mano.
UPDATE usuarios SET secciones_admin = ARRAY[
    'dashboard','enrolar','clientes','sesiones','buscar','metricas','sii',
    'capital_natural','trazabilidad','transporte','corredor','origen',
    'capacitacion','apl','prospectos','auspiciadores','juego',
    'accesos_externos','motor_propio','motor_externo','usuarios','actividad',
    'datos_personales'
  ]::text[]
  WHERE panel = 'sicrep' AND secciones_admin = '{}';
