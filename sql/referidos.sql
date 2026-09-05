-- Sistema de referidos: el código de referido es el numero_casillero de cada
-- cliente. Se premia solo a quien refiere, $5 de saldo a favor, una sola vez
-- por referido, activado cuando el referido paga su primera factura.

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS saldo_a_favor NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE facturas
    ADD COLUMN IF NOT EXISTS descuento_referido NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS referidos (
    id SERIAL PRIMARY KEY,
    referidor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    referido_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
    monto_credito NUMERIC(10,2) NOT NULL DEFAULT 5.00,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','activado')),
    fecha_registro TIMESTAMP NOT NULL DEFAULT NOW(),
    fecha_activacion TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referidos_referidor ON referidos (referidor_id);
