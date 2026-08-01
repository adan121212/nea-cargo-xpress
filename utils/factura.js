/**
 * Genera el número de factura a partir del id.
 * Ejemplo: id 7 -> "FAC-000007"
 */
function generarNumeroFactura(id) {
  return `FAC-${String(id).padStart(6, '0')}`;
}

module.exports = { generarNumeroFactura };
