require('dotenv').config();

/**
 * Genera el numero de casillero a partir del id del usuario.
 * Ejemplo: id 42 -> "PN-00042"
 */
function generarNumeroCasillero(id) {
  const prefijo = process.env.CASILLERO_PREFIJO || 'PN';
  return `${prefijo}-${String(id).padStart(5, '0')}`;
}

/**
 * Arma la direccion de bodega (Miami) que el cliente debe usar
 * al comprar en tiendas de EE.UU., usando su numero de casillero como "Suite".
 */
function direccionCasillero(numeroCasillero) {
  return {
    nombre_destinatario: `${process.env.WAREHOUSE_NOMBRE || 'Tu Nombre'} - ${numeroCasillero}`,
    linea1: process.env.WAREHOUSE_DIRECCION1 || '8548 NW 66th St',
    linea2: `Suite ${numeroCasillero}`,
    ciudad: process.env.WAREHOUSE_CIUDAD || 'Miami',
    estado: process.env.WAREHOUSE_ESTADO || 'FL',
    codigo_postal: process.env.WAREHOUSE_ZIP || '33166',
    pais: 'USA',
    telefono: process.env.WAREHOUSE_TELEFONO || '',
  };
}

module.exports = { generarNumeroCasillero, direccionCasillero };
