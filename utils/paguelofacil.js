require('dotenv').config();

/**
 * Genera un "Enlace de Pago" (checkout hospedado) con PagueloFacil.
 * El cliente es redirigido a la página segura de PagueloFacil para pagar
 * con tarjeta; nunca manejamos números de tarjeta en nuestro servidor.
 *
 * Docs: https://developers.paguelofacil.com/guias/enlace-de-pago
 */

function baseUrlPagueloFacil() {
  return process.env.PAGUELOFACIL_ENV === 'production'
    ? 'https://secure.paguelofacil.com'
    : 'https://sandbox.paguelofacil.com';
}

function aHexadecimal(texto) {
  return Buffer.from(texto, 'utf8').toString('hex');
}

/**
 * @param {object} factura - debe incluir id, numero_factura, total
 * @returns {Promise<{url: string, code: string}>}
 */
async function generarEnlacePago(factura) {
  const { PAGUELOFACIL_CCLW, BASE_URL } = process.env;
  if (!PAGUELOFACIL_CCLW) {
    throw new Error('Falta configurar PAGUELOFACIL_CCLW en las variables de entorno.');
  }

  const returnUrl = `${BASE_URL}/api/pagos/retorno`;

  const params = new URLSearchParams({
    CCLW: PAGUELOFACIL_CCLW,
    CMTN: Number(factura.total).toFixed(2),
    CDSC: `Factura ${factura.numero_factura} - NEA Cargo Xpress`.slice(0, 150),
    RETURN_URL: aHexadecimal(returnUrl),
    PARM_1: String(factura.id),
    EXPIRES_IN: '3600', // el enlace expira en 1 hora
  });

  const respuesta = await fetch(`${baseUrlPagueloFacil()}/LinkDeamon.cfm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' },
    body: params.toString(),
  });

  const data = await respuesta.json();

  if (!data.success || !data.data || !data.data.url) {
    throw new Error(`PagueloFacil no pudo generar el enlace: ${data.message || 'error desconocido'}`);
  }

  return { url: data.data.url, code: data.data.code };
}

module.exports = { generarEnlacePago };
