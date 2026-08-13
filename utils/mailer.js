require('dotenv').config();

async function enviarCorreoConfirmacion(destinatario, nombre, tokenVerificacion) {
  const enlaceVerificacion = `${process.env.BASE_URL}/api/auth/verificar/${tokenVerificacion}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>¡Hola, ${nombre}!</h2>
      <p>Gracias por crear tu casillero. Para activarlo, confirma tu correo haciendo clic en el siguiente botón:</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${enlaceVerificacion}" style="background:#ff6a1a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Confirmar mi cuenta</a>
      </p>
      <p>Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
      <p><a href="${enlaceVerificacion}">${enlaceVerificacion}</a></p>
      <p>Si tú no creaste esta cuenta, puedes ignorar este mensaje.</p>
    </div>`;
  return enviarCorreoGenerico(destinatario, 'Confirma tu registro', html);
}

async function enviarFacturaPorCorreo(destinatario, nombre, factura, pdfBuffer) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>¡Hola, ${nombre}!</h2>
      <p>Adjunto encontrarás la factura <strong>${factura.numero_factura}</strong> de tu paquete (${factura.tienda} — tracking ${factura.numero_tracking}).</p>
      <p><strong>Total a pagar: $${Number(factura.total).toFixed(2)}</strong></p>
      <p>Si tienes alguna duda, contáctanos respondiendo este correo.</p>
    </div>`;
  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'NEA Cargo Xpress <onboarding@resend.dev>',
      to: destinatario,
      subject: `Factura ${factura.numero_factura} — NEA Cargo Xpress`,
      html,
      attachments: [{ filename: `${factura.numero_factura}.pdf`, content: pdfBuffer.toString('base64') }],
    }),
  });
  if (!respuesta.ok) { const d = await respuesta.text(); throw new Error(`Resend respondió ${respuesta.status}: ${d}`); }
  return respuesta.json();
}

const ESTADO_LABEL = {
  prealertado: 'Prealertado', en_bodega_miami: 'En bodega Miami', en_transito: 'En tránsito',
  en_panama: 'En Panamá', listo_para_retiro: 'Listo para retiro', entregado: 'Entregado',
};
const ESTADO_MENSAJE = {
  en_bodega_miami: 'Tu paquete ya llegó a nuestra bodega en Miami. Pronto lo preparamos para su viaje a Panamá.',
  en_transito: 'Tu paquete ya salió de Miami y está en camino a Panamá.',
  en_panama: 'Tu paquete ya llegó a Panamá y está en proceso de clasificación/aduana.',
  listo_para_retiro: '¡Tu paquete ya está listo para que lo retires en tu sucursal más cercana!',
  entregado: 'Tu paquete fue entregado. Gracias por confiar en nosotros.',
};

async function enviarCorreoCambioEstado(destinatario, nombre, paquete) {
  const ESTADOS_QUE_NOTIFICAN = ['en_bodega_miami', 'listo_para_retiro'];
  if (!ESTADOS_QUE_NOTIFICAN.includes(paquete.estado)) return;
  const etiqueta = ESTADO_LABEL[paquete.estado] || paquete.estado;
  const mensaje = ESTADO_MENSAJE[paquete.estado] || `Tu paquete cambió de estado a: ${etiqueta}.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>¡Hola, ${nombre}!</h2>
      <p>${mensaje}</p>
      <div style="background:#f5f6f8;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 6px;"><strong>${paquete.tienda}</strong></p>
        <p style="margin:0 0 6px;color:#6b7280;">Tracking: ${paquete.numero_tracking}</p>
        <p style="margin:0;"><span style="background:#ff6a1a;color:#fff;padding:4px 10px;border-radius:20px;font-size:12px;">${etiqueta}</span></p>
      </div>
      <p>Puedes ver el detalle completo iniciando sesión en tu cuenta.</p>
    </div>`;
  return enviarCorreoGenerico(destinatario, `Tu paquete está: ${etiqueta} — NEA Cargo Xpress`, html);
}

async function enviarCorreoRecuperacion(destinatario, nombre, tokenReset) {
  const enlace = `${process.env.BASE_URL}/app.html?reset=${tokenReset}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>¡Hola, ${nombre}!</h2>
      <p>Recibimos una solicitud para restablecer tu contraseña. Si fuiste tú, haz clic en el botón de abajo (el enlace expira en 1 hora):</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${enlace}" style="background:#ff6a1a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Restablecer mi contraseña</a>
      </p>
      <p>Si el botón no funciona, copia y pega este enlace: <a href="${enlace}">${enlace}</a></p>
      <p>Si tú no solicitaste esto, puedes ignorar este mensaje.</p>
    </div>`;
  return enviarCorreoGenerico(destinatario, 'Recupera tu contraseña — NEA Cargo Xpress', html);
}

async function enviarCorreoNuevoRegistroAdmin(usuario) {
  const correoAdmin = process.env.ADMIN_NOTIFICACION_EMAIL;
  if (!correoAdmin) { console.warn('ADMIN_NOTIFICACION_EMAIL no configurado.'); return; }
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>Nuevo cliente registrado</h2>
      <div style="background:#f5f6f8;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 6px;"><strong>${usuario.nombre} ${usuario.apellido}</strong></p>
        <p style="margin:0 0 6px;color:#6b7280;">${usuario.email}</p>
        ${usuario.telefono ? `<p style="margin:0 0 6px;color:#6b7280;">${usuario.telefono}</p>` : ''}
        <p style="margin:0;"><span style="background:#ff6a1a;color:#fff;padding:4px 10px;border-radius:20px;font-size:12px;">${usuario.numero_casillero}</span></p>
      </div>
      <p>Todavía debe confirmar su correo antes de poder iniciar sesión.</p>
    </div>`;
  return enviarCorreoGenerico(correoAdmin, `Nuevo registro: ${usuario.nombre} ${usuario.apellido} — NEA Cargo Xpress`, html);
}

async function enviarFacturaListaParaRetiro(destinatario, nombre, factura, pdfBuffer) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>¡Hola, ${nombre}!</h2>
      <p>¡Tu paquete ya está listo para que lo retires en tu sucursal más cercana! 🎉</p>
      <div style="background:#f5f6f8;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 6px;"><strong>${factura.tienda}</strong></p>
        <p style="margin:0 0 6px;color:#6b7280;">Tracking: ${factura.numero_tracking}</p>
        <p style="margin:0;"><span style="background:#ff6a1a;color:#fff;padding:4px 10px;border-radius:20px;font-size:12px;">Listo para retiro</span></p>
      </div>
      <p>Adjunto encontrarás la factura <strong>${factura.numero_factura}</strong> — está <strong>pendiente de pago</strong>, la puedes cancelar directamente al momento de retirar tu paquete.</p>
      <p><strong>Total a pagar: $${Number(factura.total).toFixed(2)}</strong></p>
      <p>Te esperamos. Si tienes alguna duda, contáctanos respondiendo este correo.</p>
    </div>`;
  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'NEA Cargo Xpress <onboarding@resend.dev>',
      to: destinatario,
      subject: `Tu paquete está listo para retiro — Factura ${factura.numero_factura} — NEA Cargo Xpress`,
      html,
      attachments: [{ filename: `${factura.numero_factura}.pdf`, content: pdfBuffer.toString('base64') }],
    }),
  });
  if (!respuesta.ok) { const d = await respuesta.text(); throw new Error(`Resend respondió ${respuesta.status}: ${d}`); }
  return respuesta.json();
}

/**
 * Función genérica para enviar cualquier correo HTML sin adjuntos.
 * Usada internamente y también por caja.js para el reporte de cierre.
 */
async function enviarCorreoGenerico(destinatario, asunto, html) {
  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'NEA Cargo Xpress <onboarding@resend.dev>',
      to: destinatario,
      subject: asunto,
      html,
    }),
  });
  if (!respuesta.ok) { const d = await respuesta.text(); throw new Error(`Resend respondió ${respuesta.status}: ${d}`); }
  return respuesta.json();
}

module.exports = {
  enviarCorreoConfirmacion,
  enviarFacturaPorCorreo,
  enviarCorreoCambioEstado,
  enviarCorreoRecuperacion,
  enviarCorreoNuevoRegistroAdmin,
  enviarFacturaListaParaRetiro,
  enviarCorreoGenerico,
};
