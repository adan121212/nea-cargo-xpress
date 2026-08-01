-- Ejecuta esto en el SQL Editor de Neon si ya tenías la tabla facturas creada
-- (de la fase anterior de facturación). Si vas a crear la base desde cero,
-- usa sql/schema.sql directamente, ya incluye este cambio.

ALTER TABLE facturas
    ADD COLUMN IF NOT EXISTS token_pdf VARCHAR(64) UNIQUE;
