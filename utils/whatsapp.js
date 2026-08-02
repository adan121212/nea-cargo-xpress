require('dotenv').config();

const ESTADO_LABEL = {
  prealertado: 'Prealertado',
  en_bodega_miami: 'En bodega Miami',
  en_transito: 'En tránsito',
  en_panama: 'En Panamá',
  listo_para_retiro: 'Listo para retiro',
  entregado: 'Entregado',
};

const ESTADO_MENSAJE = {
  en_bodega_miami: 'Ya llegó a nuestra bodega en Miami. Pronto lo preparamos para su viaje a Panamá.',
  en_transito: 'Ya salió de Miami y está en camino a Panamá.',
  en_panama: 'Ya llegó a Panamá y está en proceso de clasificación/aduana.',
  listo_para_retiro: '¡Ya está listo para que lo retires en tu sucursal más cercana!',
  entregado: 'Fue entregado. Gracias por confiar en nosotros.',
};

/**
 * Envía un mensaje de WhatsApp vía Twilio. Función interna reutilizada por
 * las funciones exportadas de abajo.
 *
 * Requiere en .env:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM   (ej. "whatsapp:+14155238886" para el sandbox de pruebas)
 *
 * `telefono` debe venir en formato internacional, ej. "+507 6123-4567" o "50761234567".
 */
async function enviarMensajeWhatsapp(telefono, mensaje, mediaUrl) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
    throw new Error('Faltan variables de entorno de Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM).');
  }

  const telefonoLimpio = telefono.replace(/[^\d+]/g, '');
  const numeroDestino = telefonoLimpio.startsWith('+') ? telefonoLimpio : `+${telefonoLimpio}`;

  const params = new URLSearchParams();
  params.set('To', `whatsapp:${numeroDestino}`);
  params.set('From', TWILIO_WHATSAPP_FROM);
  params.set('Body', mensaje);
  if (mediaUrl) params.set('MediaUrl', mediaUrl);

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

/**
 * Envía un mensaje de WhatsApp con el link al PDF de la factura.
 * `urlPdfPublica` es la URL pública (sin login) donde Twilio puede descargar el PDF.
 */
async function enviarFacturaPorWhatsapp(telefono, factura, urlPdfPublica) {
  const mensaje =
    `📦 *NEA Cargo Xpress*\n\n` +
    `Factura ${factura.numero_factura}\n` +
    `Paquete: ${factura.tienda} (${factura.numero_tracking})\n` +
    `Total: $${Number(factura.total).toFixed(2)}\n\n` +
    `Descarga tu factura en PDF aquí:\n${urlPdfPublica}`;

  return enviarMensajeWhatsapp(telefono, mensaje, urlPdfPublica);
}

/**
 * Envía un mensaje de WhatsApp avisando que el estado de un paquete cambió.
 * `paquete` debe traer: tienda, numero_tracking, estado.
 */
async function enviarWhatsappCambioEstado(telefono, paquete) {
  const etiqueta = ESTADO_LABEL[paquete.estado] || paquete.estado;
  const detalle = ESTADO_MENSAJE[paquete.estado] || `Cambió de estado a: ${etiqueta}.`;

  const mensaje =
    `📦 *NEA Cargo Xpress*\n\n` +
    `${paquete.tienda} (${paquete.numero_tracking})\n` +
    `Estado: *${etiqueta}*\n\n` +
    `${detalle}`;

  return enviarMensajeWhatsapp(telefono, mensaje);
}

module.exports = { enviarFacturaPorWhatsapp, enviarWhatsappCambioEstado };
