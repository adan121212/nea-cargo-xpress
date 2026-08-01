require('dotenv').config();

/**
 * Envía correo usando la API HTTP de Resend (https://resend.com).
 * Se usa HTTP en vez de SMTP porque muchos hostings gratuitos (Render, Railway, etc.)
 * bloquean o limitan las conexiones SMTP salientes hacia Gmail/Outlook, causando
 * timeouts. La API de Resend viaja por HTTPS (puerto 443), que siempre está abierto.
 */
async function enviarCorreoConfirmacion(destinatario, nombre, tokenVerificacion) {
  const enlaceVerificacion = `${process.env.BASE_URL}/api/auth/verificar/${tokenVerificacion}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>¡Hola, ${nombre}!</h2>
      <p>Gracias por crear tu casillero. Para activarlo, confirma tu correo haciendo clic en el siguiente botón:</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${enlaceVerificacion}"
           style="background:#ff6a1a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
          Confirmar mi cuenta
        </a>
      </p>
      <p>Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
      <p><a href="${enlaceVerificacion}">${enlaceVerificacion}</a></p>
      <p>Si tú no creaste esta cuenta, puedes ignorar este mensaje.</p>
    </div>
  `;

  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'NEA Cargo Xpress <onboarding@resend.dev>',
      to: destinatario,
      subject: 'Confirma tu registro',
      html,
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`Resend respondió ${respuesta.status}: ${detalle}`);
  }

  return respuesta.json();
}

/**
 * Envía la factura por correo con el PDF adjunto (vía Resend).
 */
async function enviarFacturaPorCorreo(destinatario, nombre, factura, pdfBuffer) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>¡Hola, ${nombre}!</h2>
      <p>Adjunto encontrarás la factura <strong>${factura.numero_factura}</strong> de tu paquete
         (${factura.tienda} — tracking ${factura.numero_tracking}).</p>
      <p><strong>Total a pagar: $${Number(factura.total).toFixed(2)}</strong></p>
      <p>Si tienes alguna duda, contáctanos respondiendo este correo.</p>
    </div>
  `;

  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'NEA Cargo Xpress <onboarding@resend.dev>',
      to: destinatario,
      subject: `Factura ${factura.numero_factura} — NEA Cargo Xpress`,
      html,
      attachments: [
        {
          filename: `${factura.numero_factura}.pdf`,
          content: pdfBuffer.toString('base64'),
        },
      ],
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`Resend respondió ${respuesta.status}: ${detalle}`);
  }

  return respuesta.json();
}

module.exports = { enviarCorreoConfirmacion, enviarFacturaPorCorreo };
