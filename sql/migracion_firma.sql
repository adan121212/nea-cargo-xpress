-- Ejecuta esto en el SQL Editor de Neon si ya tenías la tabla paquetes creada.
-- Si vas a crear la base desde cero, usa sql/schema.sql directamente.

ALTER TABLE paquetes
    ADD COLUMN IF NOT EXISTS firma_url TEXT,
    ADD COLUMN IF NOT EXISTS firma_public_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS fecha_entrega TIMESTAMP;
