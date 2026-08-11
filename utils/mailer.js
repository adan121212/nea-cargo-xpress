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

const ESTADO_LABEL = {
  prealertado: 'Prealertado',
  en_bodega_miami: 'En bodega Miami',
  en_transito: 'En tránsito',
  en_panama: 'En Panamá',
  listo_para_retiro: 'Listo para retiro',
  entregado: 'Entregado',
};

const ESTADO_MENSAJE = {
  en_bodega_miami: 'Tu paquete ya llegó a nuestra bodega en Miami. Pronto lo preparamos para su viaje a Panamá.',
  en_transito: 'Tu paquete ya salió de Miami y está en camino a Panamá.',
  en_panama: 'Tu paquete ya llegó a Panamá y está en proceso de clasificación/aduana.',
  listo_para_retiro: '¡Tu paquete ya está listo para que lo retires en tu sucursal más cercana!',
  entregado: 'Tu paquete fue entregado. Gracias por confiar en nosotros.',
};

/**
 * Envía un correo avisando que el estado de un paquete cambió.
 * Solo se envía para los estados que realmente importan al cliente:
 * "en_bodega_miami" (ya llegó a Miami) y "listo_para_retiro" (puede ir a buscarlo).
 * Los estados intermedios (en_transito, en_panama, entregado) no generan correo
 * para no saturar al cliente con notificaciones innecesarias.
 * `paquete` debe traer: tienda, numero_tracking, estado.
 */
async function enviarCorreoCambioEstado(destinatario, nombre, paquete) {
  const ESTADOS_QUE_NOTIFICAN = ['en_bodega_miami', 'listo_para_retiro'];
  if (!ESTADOS_QUE_NOTIFICAN.includes(paquete.estado)) {
    return; // no enviamos correo para este estado
  }

  const etiqueta = ESTADO_LABEL[paquete.estado] || paquete.estado;
  const mensaje = ESTADO_MENSAJE[paquete.estado] || `Tu paquete cambió de estado a: ${etiqueta}.`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>¡Hola, ${nombre}!</h2>
      <p>${mensaje}</p>
      <div style="background:#f5f6f8;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 6px;"><strong>${paquete.tienda}</strong></p>
        <p style="margin:0 0 6px;color:#6b7280;">Tracking: ${paquete.numero_tracking}</p>
        <p style="margin:0;">
          <span style="background:#ff6a1a;color:#fff;padding:4px 10px;border-radius:20px;font-size:12px;">
            ${etiqueta}
          </span>
        </p>
      </div>
      <p>Puedes ver el detalle completo iniciando sesión en tu cuenta.</p>
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
      subject: `Tu paquete está: ${etiqueta} — NEA Cargo Xpress`,
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
 * Envía el correo de recuperación de contraseña con un enlace temporal.
 */
async function enviarCorreoRecuperacion(destinatario, nombre, tokenReset) {
  const enlace = `${process.env.BASE_URL}/app.html?reset=${tokenReset}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>¡Hola, ${nombre}!</h2>
      <p>Recibimos una solicitud para restablecer tu contraseña. Si fuiste tú, haz clic en el botón de abajo (el enlace expira en 1 hora):</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${enlace}"
           style="background:#ff6a1a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
          Restablecer mi contraseña
        </a>
      </p>
      <p>Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
      <p><a href="${enlace}">${enlace}</a></p>
      <p>Si tú no solicitaste esto, puedes ignorar este mensaje — tu contraseña no cambiará.</p>
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
      subject: 'Recupera tu contraseña — NEA Cargo Xpress',
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
 * Te avisa a TI (el dueño/admin) cuando un cliente nuevo se registra.
 * Se manda al correo configurado en ADMIN_NOTIFICACION_EMAIL.
 */
async function enviarCorreoNuevoRegistroAdmin(usuario) {
  const correoAdmin = process.env.ADMIN_NOTIFICACION_EMAIL;
  if (!correoAdmin) {
    console.warn('ADMIN_NOTIFICACION_EMAIL no configurado — se omite el aviso de nuevo registro.');
    return;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>Nuevo cliente registrado</h2>
      <div style="background:#f5f6f8;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 6px;"><strong>${usuario.nombre} ${usuario.apellido}</strong></p>
        <p style="margin:0 0 6px;color:#6b7280;">${usuario.email}</p>
        ${usuario.telefono ? `<p style="margin:0 0 6px;color:#6b7280;">${usuario.telefono}</p>` : ''}
        <p style="margin:0;">
          <span style="background:#ff6a1a;color:#fff;padding:4px 10px;border-radius:20px;font-size:12px;">
            ${usuario.numero_casillero}
          </span>
        </p>
      </div>
      <p>Todavía debe confirmar su correo antes de poder iniciar sesión.</p>
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
      to: correoAdmin,
      subject: `Nuevo registro: ${usuario.nombre} ${usuario.apellido} — NEA Cargo Xpress`,
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
 * Correo combinado: avisa que el paquete ya llegó/está listo para retiro
 * Y adjunta la factura pendiente de pago — todo en un solo correo.
 * Se usa cuando se confirma el peso y se genera la factura automáticamente.
 */
async function enviarFacturaListaParaRetiro(destinatario, nombre, factura, pdfBuffer) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>¡Hola, ${nombre}!</h2>
      <p>¡Tu paquete ya está listo para que lo retires en tu sucursal más cercana! 🎉</p>
      <div style="background:#f5f6f8;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 6px;"><strong>${factura.tienda}</strong></p>
        <p style="margin:0 0 6px;color:#6b7280;">Tracking: ${factura.numero_tracking}</p>
        <p style="margin:0;">
          <span style="background:#ff6a1a;color:#fff;padding:4px 10px;border-radius:20px;font-size:12px;">
            Listo para retiro
          </span>
        </p>
      </div>
      <p>Adjunto encontrarás la factura <strong>${factura.numero_factura}</strong> — está <strong>pendiente de pago</strong>, la puedes cancelar directamente al momento de retirar tu paquete.</p>
      <p><strong>Total a pagar: $${Number(factura.total).toFixed(2)}</strong></p>
      <p>Te esperamos. Si tienes alguna duda, contáctanos respondiendo este correo.</p>
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
      subject: `Tu paquete está listo para retiro — Factura ${factura.numero_factura} — NEA Cargo Xpress`,
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

module.exports = {
  enviarCorreoConfirmacion,
  enviarFacturaPorCorreo,
  enviarCorreoCambioEstado,
  enviarCorreoRecuperacion,
  enviarCorreoNuevoRegistroAdmin,
  enviarFacturaListaParaRetiro,
};
