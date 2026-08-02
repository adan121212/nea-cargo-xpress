-- Ejecuta esto en el SQL Editor de Neon si ya tenías la tabla usuarios creada.
-- Si vas a crear la base desde cero, usa sql/schema.sql directamente.

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS token_reset_password VARCHAR(255),
    ADD COLUMN IF NOT EXISTS token_reset_expira TIMESTAMP;
