-- El método usado por ítem ('fisico' | 'gasto') se calculaba en
-- motorPropio.calcularItem() pero calcularFactura() lo descartaba antes de
-- persistir — nunca era medible retroactivamente si el motor estaba
-- cayendo a "por gasto" más de lo necesario. Se persiste desde ahora.
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS metodo TEXT;
