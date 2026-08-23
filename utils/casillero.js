require('dotenv').config();

/**
 * Genera el numero de casillero a partir del id del usuario.
 * Ejemplo: id 42 -> "PN-00042"
 */
function generarNumeroCasillero(id) {
  const prefijo = String(process.env.CASILLERO_PREFIJO || 'PTY-14981')
    .replace(/\s+/g, '')
    .toUpperCase();
  return `${prefijo}-${String(id).padStart(5, '0')}`;
}

/**
 * Arma la direccion de bodega (Miami) que el cliente debe usar
 * al comprar en tiendas de EE.UU., usando su numero de casillero como "Suite".
 * nombreCompleto: nombre real del cliente autenticado (ej. "Adan Fernandez").
 */
function direccionCasillero(numeroCasillero, nombreCompleto) {
  return {
    nombre_destinatario: `${nombreCompleto || 'Tu Nombre'} - ${numeroCasillero}`,
    linea1: process.env.WAREHOUSE_DIRECCION1 || '8610 NW 72 Street',
    linea2: `Suite ${numeroCasillero}`,
    ciudad: process.env.WAREHOUSE_CIUDAD || 'Miami',
    estado: process.env.WAREHOUSE_ESTADO || 'FL',
    codigo_postal: process.env.WAREHOUSE_ZIP || '33195',
    pais: 'USA',
    telefono: process.env.WAREHOUSE_TELEFONO || '1-305-406-3654',
  };
}

module.exports = { generarNumeroCasillero, direccionCasillero };
