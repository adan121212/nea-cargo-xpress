-- Ejecuta esto en el SQL Editor de Neon si ya tenías la tabla facturas creada.
-- Si vas a crear la base desde cero, usa sql/schema.sql directamente.

ALTER TABLE facturas
    ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'facturas_metodo_pago_check'
    ) THEN
        ALTER TABLE facturas ADD CONSTRAINT facturas_metodo_pago_check
            CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'transferencia', 'pagueloFacil') OR metodo_pago IS NULL);
    END IF;
END $$;
