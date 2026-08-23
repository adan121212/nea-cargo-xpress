-- ============================================================================
-- Migración: dimensiones de paquete, peso volumétrico, sucursal, datos de
-- retiro, RUC del cliente y tabla de cierres de caja.
--
-- Estas columnas y tablas YA existían en la base de datos de producción
-- (se agregaron a mano en su momento), pero nunca se habían guardado como
-- archivo de migración en el repo. Este script las documenta para que el
-- esquema de GitHub coincida con la base real.
--
-- Es seguro correrlo varias veces: todo usa IF NOT EXISTS, así que si las
-- columnas/tablas ya están, no hace absolutamente nada. Solo tiene efecto
-- si se recrea la base de datos desde cero.
-- ============================================================================

-- --- Dimensiones de la caja + peso volumétrico (tabla paquetes) ---
-- Se usan para tarifas "por volumen": el peso volumétrico se calcula del
-- tamaño de la caja y, si la tarifa elegida es de volumen, se factura ese
-- peso en vez del real de balanza.
ALTER TABLE paquetes
    ADD COLUMN IF NOT EXISTS largo_in NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS ancho_in NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS alto_in NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS peso_volumetrico_lb NUMERIC(6,2);

-- --- Peso confirmado por el staff (bandera) ---
-- TRUE cuando el staff ya pesó el paquete en bodega y confirmó peso_real_lb.
ALTER TABLE paquetes
    ADD COLUMN IF NOT EXISTS peso_confirmado BOOLEAN NOT NULL DEFAULT FALSE;

-- --- Sucursal de retiro asignada al paquete ---
ALTER TABLE paquetes
    ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES sucursales(id) ON DELETE SET NULL;

-- --- Datos de quién retiró el paquete (entrega en mostrador) ---
ALTER TABLE paquetes
    ADD COLUMN IF NOT EXISTS retirado_por_nombre VARCHAR(120),
    ADD COLUMN IF NOT EXISTS retirado_por_cedula VARCHAR(40);

-- --- RUC del cliente (para facturación) ---
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS ruc VARCHAR(40);

-- --- Tabla de cierres de caja diarios ---
-- Un registro por día cerrado: guarda el desglose por método de pago (JSON),
-- el total, cuántas facturas se cobraron y quién lo cerró.
CREATE TABLE IF NOT EXISTS cierres_caja (
    id SERIAL PRIMARY KEY,
    fecha DATE NOT NULL UNIQUE,
    cerrado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    detalle_por_metodo JSONB NOT NULL DEFAULT '{}'::jsonb,
    total_general NUMERIC(12,2) NOT NULL DEFAULT 0,
    cantidad_facturas INTEGER NOT NULL DEFAULT 0,
    notas TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cierres_caja_fecha ON cierres_caja (fecha);
