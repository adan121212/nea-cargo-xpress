-- ============================================================
-- Módulo: Gastos de la empresa
-- ============================================================
-- Registra todo lo que sale de la empresa, para poder saber la
-- ganancia real: lo cobrado menos lo gastado.
-- ============================================================

CREATE TABLE IF NOT EXISTS gastos (
  id                SERIAL PRIMARY KEY,

  fecha             DATE NOT NULL,              -- el día del gasto, no el de registro
  categoria         TEXT NOT NULL,
  descripcion       TEXT NOT NULL,
  monto             NUMERIC(10,2) NOT NULL CHECK (monto > 0),

  proveedor         TEXT,
  numero_documento  TEXT,                       -- factura o recibo del proveedor
  metodo_pago       TEXT,                       -- efectivo, tarjeta, transferencia, yappy

  -- Si se pagó en efectivo sacándolo de la caja del día,
  -- hay que restarlo al cuadrar el efectivo del cierre.
  sale_de_caja      BOOLEAN NOT NULL DEFAULT FALSE,

  -- Los que se repiten todos los meses (alquiler, salarios, internet)
  es_recurrente     BOOLEAN NOT NULL DEFAULT FALSE,

  comprobante_url   TEXT,                       -- foto del recibo
  comprobante_id    TEXT,                       -- public_id de Cloudinary

  notas             TEXT,
  registrado_por    INTEGER REFERENCES usuarios(id),
  creado_en         TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gastos_fecha     ON gastos(fecha);
CREATE INDEX IF NOT EXISTS idx_gastos_categoria ON gastos(categoria);
CREATE INDEX IF NOT EXISTS idx_gastos_caja      ON gastos(fecha, sale_de_caja);

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'gastos' ORDER BY ordinal_position;
