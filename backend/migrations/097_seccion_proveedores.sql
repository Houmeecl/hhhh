-- ============================================================
-- secciones_admin: agrega 'proveedores' al vocabulario (092) — una
-- sección MÁS ANGOSTA que 'accesos_externos' (que además cubre
-- mandantes/puertos/agencias/trazadores/códigos/puntos_limpios) y que
-- 'sii' (que en la práctica hoy es 100% sobre empresas proveedoras,
-- pero conceptualmente es "conexión SII", no "gestión de proveedores").
--
-- Puramente aditiva: un admin puede tener 'proveedores' SIN tener
-- 'accesos_externos' ni 'sii', y así llegar solo al CRUD de empresas
-- proveedoras + su cuenta de panel propio + su conexión SII, sin ver
-- mandantes/puertos/agencias/trazadores. El backend (routes/accesos.js,
-- routes/admin.js) acepta 'proveedores' como alternativa OR en los
-- endpoints específicos de proveedores — no reemplaza ni retira nada de
-- lo que 'accesos_externos'/'sii' ya otorgaban.
--
-- Sin backfill: a diferencia del alta original de la columna (092, que
-- sí necesitó respaldar cuentas existentes para no quitarles nada), acá
-- NO hay ningún comportamiento previo que preservar — es una sección
-- nueva, nadie la tenía. Que empiece en 0 cuentas es lo correcto.
-- ============================================================

DO $$
BEGIN
  ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_secciones_admin_check;
  ALTER TABLE usuarios ADD CONSTRAINT usuarios_secciones_admin_check
    CHECK (secciones_admin <@ ARRAY[
      'dashboard','enrolar','clientes','sesiones','buscar','metricas','sii',
      'capital_natural','trazabilidad','transporte','corredor','origen',
      'capacitacion','apl','prospectos','auspiciadores','juego',
      'accesos_externos','motor_propio','motor_externo','usuarios','actividad',
      'datos_personales','proveedores'
    ]::text[]);
END $$;
