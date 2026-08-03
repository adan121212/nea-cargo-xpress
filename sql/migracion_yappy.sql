-- Ejecuta esto en el SQL Editor de Neon para permitir "yappy" como
-- metodo_pago válido en facturas (ya tenías efectivo/tarjeta/transferencia/pagueloFacil).

ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_metodo_pago_check;

ALTER TABLE facturas ADD CONSTRAINT facturas_metodo_pago_check
    CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'transferencia', 'pagueloFacil', 'yappy') OR metodo_pago IS NULL);
