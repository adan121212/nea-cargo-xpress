-- ============================================================
-- Módulo: Delivery de paquetes listos para retiro
-- ============================================================
-- El cliente pide que le lleven el paquete en vez de ir a la
-- sucursal. Se cobra el flete normal (el de la factura) más un
-- cargo de delivery calculado por distancia a la sucursal.
-- ============================================================

CREATE TABLE IF NOT EXISTS deliveries (
  id                  SERIAL PRIMARY KEY,
  usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
  paquete_id          INTEGER NOT NULL REFERENCES paquetes(id),

  -- Contacto y ubicación
  telefono            TEXT NOT NULL,
  latitud             NUMERIC(10,6),
  longitud            NUMERIC(10,6),
  direccion_texto     TEXT NOT NULL,
  referencia          TEXT,

  -- Plata
  zona_nombre         TEXT NOT NULL,
  zona_precio         NUMERIC(10,2) NOT NULL,
  flete               NUMERIC(10,2) NOT NULL DEFAULT 0,
  total               NUMERIC(10,2) NOT NULL,

  -- Estado: solicitado -> asignado -> entregado  (o cancelado)
  estado              TEXT NOT NULL DEFAULT 'solicitado',
  mensajero_nombre    TEXT,
  mensajero_telefono  TEXT,

  -- Fechas
  fecha_solicitud     TIMESTAMP DEFAULT NOW(),
  fecha_asignado      TIMESTAMP,
  fecha_entregado     TIMESTAMP,

  -- Control
  motivo_cancelacion  TEXT,
  notas               TEXT
);

CREATE INDEX IF NOT EXISTS idx_deliveries_usuario  ON deliveries(usuario_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_paquete  ON deliveries(paquete_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_estado   ON deliveries(estado);

-- Comprobar que quedó bien
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'deliveries' ORDER BY ordinal_position;
