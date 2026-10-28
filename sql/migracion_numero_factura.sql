-- ============================================================
-- Números de factura consecutivos (sin saltos)
-- ============================================================
-- Contador propio para el número de factura. Se sube dentro de la
-- misma transacción que crea la factura, así que si la factura
-- falla y se cancela, el número no se pierde.
-- Se puede correr varias veces sin problema.

CREATE TABLE IF NOT EXISTS contador_facturas (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    ultimo INTEGER NOT NULL DEFAULT 0
);

-- Arranca desde el número más alto que ya exista (o 0 si no hay facturas).
INSERT INTO contador_facturas (id, ultimo)
SELECT 1, COALESCE(MAX(NULLIF(regexp_replace(numero_factura, '\D', '', 'g'), '')::int), 0)
FROM facturas
ON CONFLICT (id) DO NOTHING;
