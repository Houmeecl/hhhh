-- Rol analítico para convertir el mismo libro privado en una ficha de
-- información financiera. No es una clasificación SII ni un score bancario:
-- solo define cómo se agrupan cuentas que el contador ya configuró.
ALTER TABLE contabilidad_cuentas
  ADD COLUMN IF NOT EXISTS rol_bancario TEXT NOT NULL DEFAULT 'otro'
  CHECK (rol_bancario IN (
    'caja','cuentas_cobrar','inventario','activo_corriente','activo_no_corriente',
    'pasivo_corriente','deuda_financiera','patrimonio','ingreso','costo','gasto','otro'
  ));
