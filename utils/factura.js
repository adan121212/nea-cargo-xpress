/**
 * Números de factura SIN saltos.
 *
 * Antes el número salía del id de la factura (id 7 -> "FAC-000007"). El id lo
 * da un contador de la base de datos que nunca da marcha atrás: si una factura
 * fallaba a medias, su número se gastaba y la siguiente saltaba (6 -> 11).
 *
 * Ahora el número sale de la tabla contador_facturas, que se sube DENTRO de la
 * misma transacción que crea la factura. Si la factura falla y se cancela
 * (ROLLBACK), el contador también vuelve atrás y el número no se pierde.
 * La fila del contador queda bloqueada hasta el COMMIT, así que dos facturas
 * al mismo tiempo nunca reciben el mismo número.
 *
 * Importante: llamar siempre con el mismo "client" que está dentro de BEGIN.
 */

/** Ejemplo: 7 -> "FAC-000007" */
function generarNumeroFactura(numero) {
  return `FAC-${String(numero).padStart(6, '0')}`;
}

/** Toma el siguiente número consecutivo (dentro de la transacción abierta). */
async function siguienteNumeroFactura(client) {
  const r = await client.query(
    'UPDATE contador_facturas SET ultimo = ultimo + 1 WHERE id = 1 RETURNING ultimo'
  );
  if (r.rows.length === 0) {
    throw new Error('Falta la fila del contador de facturas (tabla contador_facturas). Corre sql/migracion_numero_factura.sql');
  }
  return generarNumeroFactura(r.rows[0].ultimo);
}

module.exports = { generarNumeroFactura, siguienteNumeroFactura };
