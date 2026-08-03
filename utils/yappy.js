require('dotenv').config();

/**
 * Integración con el "Botón de Pago Yappy" (Banco General).
 *
 * IMPORTANTE — pasos para activarlo de verdad:
 *
 * 1. Tramita Yappy Comercial con Banco General (requiere cuenta comercial
 *    del banco). Al aprobarte te dan: merchantId y secretKey, además de la
 *    guía/URL exacta para descargar el SDK oficial de Node.js (el paquete
 *    NO está publicado en npm, se instala desde un release de GitHub cuya
 *    versión cambia con el tiempo — te la indican en su portal de
 *    desarrolladores una vez aprobado).
 *
 * 2. Instala el SDK que te indiquen, por ejemplo:
 *      npm install https://github.com/BancoGeneral/Boton-de-Pago-Yappy_Node.js/releases/download/<VERSION>/yappy-node-back-sdk-<VERSION>.tar
 *
 * 3. Agrega las variables de entorno (ver .env.example):
 *      YAPPY_MERCHANT_ID
 *      YAPPY_SECRET_KEY
 *
 * 4. Descomenta el require de abajo y ajusta el constructor si el SDK que
 *    te den usa nombres de parámetros distintos (verifica contra la
 *    documentación que te entregue Banco General, los detalles exactos del
 *    SDK pueden variar entre versiones).
 */

// const YappySDK = require('yappy-node-back-sdk');

function clienteYappyDisponible() {
  return Boolean(process.env.YAPPY_MERCHANT_ID && process.env.YAPPY_SECRET_KEY);
}

function obtenerClienteYappy() {
  if (!clienteYappyDisponible()) {
    throw new Error(
      'Yappy todavía no está configurado (faltan YAPPY_MERCHANT_ID / YAPPY_SECRET_KEY en las variables de entorno).'
    );
  }

  // eslint-disable-next-line global-require
  let YappySDK;
  try {
    YappySDK = require('yappy-node-back-sdk');
  } catch (error) {
    throw new Error(
      'El paquete del SDK de Yappy no está instalado todavía. Instálalo siguiendo las instrucciones en utils/yappy.js.'
    );
  }

  return new YappySDK({
    merchantId: process.env.YAPPY_MERCHANT_ID,
    secretKey: process.env.YAPPY_SECRET_KEY,
    domain: process.env.BASE_URL,
  });
}

/**
 * Genera el enlace de pago de Yappy para una factura.
 * `factura` debe traer: id, numero_factura, total, cliente_telefono (opcional).
 */
async function generarEnlacePagoYappy(factura) {
  const cliente = obtenerClienteYappy();

  const payment = {
    total: Number(factura.total),
    subtotal: Number(factura.total),
    shipping: 0,
    discount: 0,
    taxes: 0,
    orderId: String(factura.id),
    successUrl: `${process.env.BASE_URL}/api/pagos/yappy/retorno`,
    failUrl: `${process.env.BASE_URL}/api/pagos/yappy/retorno`,
    tel: factura.cliente_telefono ? factura.cliente_telefono.replace(/[^\d]/g, '') : '',
    domain: process.env.BASE_URL,
  };

  const respuesta = await cliente.getPaymentUrl(payment);
  return respuesta; // { url: '...' } según el SDK
}

/**
 * Valida que la respuesta de retorno realmente venga de Yappy (verifica el hash).
 */
function validarRespuestaYappy(query) {
  const cliente = obtenerClienteYappy();
  return cliente.validateHash(query);
}

module.exports = { clienteYappyDisponible, generarEnlacePagoYappy, validarRespuestaYappy };
