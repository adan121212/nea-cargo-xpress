// Cálculos compartidos para saber cuánto se le cobra a un paquete según su tarifa.
// Se usan tanto al generar una factura desde el Facturador como al confirmar el
// peso de un paquete en la pestaña Paquetes.

// Volumen real de la caja en pies cúbicos (ft³), a partir de las medidas en pulgadas.
// Fórmula estándar de carga marítima: Largo × Ancho × Alto (in) ÷ 1728.
function calcularVolumenFt3(paquete) {
  const largo = Number(paquete?.largo_in || 0);
  const ancho = Number(paquete?.ancho_in || 0);
  const alto = Number(paquete?.alto_in || 0);
  if (!largo || !ancho || !alto) return null;
  const ft3 = (largo * ancho * alto) / 1728;
  return ft3 > 0 ? Math.round(ft3 * 100) / 100 : null;
}

// Devuelve la cantidad que se debe facturar según la unidad de la tarifa:
// - tarifas por pie cúbico (unidad 'ft3'): el volumen real de la caja.
// - tarifas por libra (unidad 'lb', o sin unidad = tarifas creadas antes de esto):
//   si el nombre de la tarifa contiene "volumen", el MAYOR entre peso volumétrico y
//   peso real (nunca menos que la balanza); si no, el peso real de la balanza.
// pesoRealOverride permite pasar un peso que aún no está guardado en el paquete
// (por ejemplo, el que se acaba de escribir en el campo de "confirmar peso").
function calcularCantidadFacturable(paquete, tarifa, pesoRealOverride) {
  if (tarifa && tarifa.unidad === 'ft3') {
    return calcularVolumenFt3(paquete);
  }
  const pesoReal = Number(pesoRealOverride ?? paquete?.peso_real_lb ?? paquete?.peso_lb ?? 0);
  const pesoVol = Number(paquete?.peso_volumetrico_lb ?? 0);
  const esTarifaVolumetrica = /volum/i.test((tarifa && tarifa.nombre) || '');
  // REGLA: nunca se factura por debajo del peso real de la balanza.
  // En tarifas por volumen se cobra el MAYOR entre el peso real y el volumétrico.
  const peso = (esTarifaVolumetrica && pesoVol > 0) ? Math.max(pesoVol, pesoReal) : pesoReal;
  return peso || null;
}

module.exports = { calcularVolumenFt3, calcularCantidadFacturable };
