require('dotenv').config();

/**
 * Envía un mensaje de WhatsApp con el link al PDF de la factura, usando Twilio.
 *
 * Requiere en .env:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM   (ej. "whatsapp:+14155238886" para el sandbox de pruebas)
 *
 * `telefono` debe venir en formato internacional, ej. "+507 6123-4567" o "50761234567".
 * `urlPdfPublica` es la URL pública (sin login) donde Twilio puede descargar el PDF.
 */
async function enviarFacturaPorWhatsapp(telefono, factura, urlPdfPublica) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
    throw new Error('Faltan variables de entorno de Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM).');
  }

  const telefonoLimpio = telefono.replace(/[^\d+]/g, '');
  const numeroDestino = telefonoLimpio.startsWith('+') ? telefonoLimpio : `+${telefonoLimpio}`;

  const mensaje =
    `📦 *NEA Cargo Xpress*\n\n` +
    `Factura ${factura.numero_factura}\n` +
    `Paquete: ${factura.tienda} (${factura.numero_tracking})\n` +
    `Total: $${Number(factura.total).toFixed(2)}\n\n` +
    `Descarga tu factura en PDF aquí:\n${urlPdfPublica}`;

  const params = new URLSearchParams();
  params.set('To', `whatsapp:${numeroDestino}`);
  params.set('From', TWILIO_WHATSAPP_FROM);
  params.set('Body', mensaje);
  params.set('MediaUrl', urlPdfPublica);

  const credenciales = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const respuesta = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credenciales}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }
  );

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`Twilio respondió ${respuesta.status}: ${detalle}`);
  }

  return respuesta.json();
}

module.exports = { enviarFacturaPorWhatsapp };
