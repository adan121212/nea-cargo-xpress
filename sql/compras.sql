-- ============================================================
-- Módulo: Servicio Profesional de Compras
-- ============================================================
-- Registra las compras que NEA hace con su tarjeta a nombre del
-- cliente. El dinero del producto es un reembolso, NO es ingreso.
-- Lo único que entra a caja como venta son los $5 de comisión.
-- ============================================================

CREATE TABLE IF NOT EXISTS compras (
  id                SERIAL PRIMARY KEY,
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id),

  -- Qué se va a comprar
  tienda            TEXT NOT NULL,
  descripcion       TEXT NOT NULL,
  enlace            TEXT,

  -- Plata
  monto_producto    NUMERIC(10,2) NOT NULL,          -- lo que costó en la tienda
  comision          NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  total_cobrado     NUMERIC(10,2) NOT NULL,          -- producto + comisión

  -- Estado: solicitada -> comprada -> pagada  (o cancelada)
  estado            TEXT NOT NULL DEFAULT 'solicitada',

  -- Datos que aparecen al comprar
  numero_orden      TEXT,
  numero_tracking   TEXT,
  paquete_id        INTEGER REFERENCES paquetes(id) ON DELETE SET NULL,

  -- Cobro al cliente
  metodo_pago       TEXT,

  -- Fechas
  fecha_solicitud   TIMESTAMP DEFAULT NOW(),
  fecha_compra      TIMESTAMP,
  fecha_pago        TIMESTAMP,

  -- Control
  registrada_por    INTEGER REFERENCES usuarios(id),
  comprada_por      INTEGER REFERENCES usuarios(id),
  notas             TEXT,
  motivo_cancelacion TEXT
);

CREATE INDEX IF NOT EXISTS idx_compras_usuario ON compras(usuario_id);
CREATE INDEX IF NOT EXISTS idx_compras_estado  ON compras(estado);
CREATE INDEX IF NOT EXISTS idx_compras_pago    ON compras(fecha_pago);

-- Comprobar que quedó bien
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'compras' ORDER BY ordinal_position;
