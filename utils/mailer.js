require('dotenv').config();

const TEMPLATE_FACTURA = 'invoice-attached';

const ESTADO_LABEL = {
  prealertado: 'Prealertado', en_bodega_miami: 'En bodega Miami', en_transito: 'En tránsito',
  en_panama: 'En Panamá', listo_para_retiro: 'Listo para retiro', entregado: 'Entregado',
};
const ESTADO_MENSAJE = {
  en_bodega_miami: 'Tu paquete ya llegó a nuestra bodega en Miami. Pronto lo preparamos para su viaje a Panamá.',
  en_transito: 'Tu paquete ya salió de Miami y está en camino a Panamá.',
  en_panama: 'Tu paquete ya llegó a Panamá y está en proceso de clasificación/aduana.',
  listo_para_retiro: '¡Tu paquete ya está listo para que lo retires!',
  entregado: 'Tu paquete fue entregado. Gracias por confiar en nosotros.',
};

/**
 * Bloque HTML con los datos de la sucursal donde retirar.
 * Si no hay sucursal asignada, devuelve un texto genérico.
 */
function bloqueSucursal(suc) {
  if (!suc || !suc.sucursal_nombre) {
    return `<p style="margin:0 0 18px;">Puedes retirarlo en cualquiera de nuestras sucursales presentando tu cédula.</p>`;
  }
  return `
    <div style="background:#e8f5f1;border-left:4px solid #177a63;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="margin:0 0 8px;font-weight:bold;color:#0f6b4f;">📍 Retíralo en: ${suc.sucursal_nombre}</p>
      <p style="margin:0 0 5px;color:#374151;">${suc.sucursal_direccion || ''}</p>
      ${suc.sucursal_telefono ? `<p style="margin:0 0 5px;color:#6b7280;">📞 ${suc.sucursal_telefono}</p>` : ''}
      ${suc.sucursal_horario ? `<p style="margin:0;color:#6b7280;">🕐 ${suc.sucursal_horario}</p>` : ''}
    </div>
    <p style="margin:0 0 18px;font-size:13px;color:#6b7280;">Recuerda llevar tu cédula de identidad.</p>`;
}

/**
 * Arma las variables que espera el template "invoice-attached" en Resend.
 * Ninguna puede ir vacía o nula: si falta un dato, Resend rechaza el envío.
 */
function variablesFactura(nombre, factura) {
  const tieneSucursal = !!(factura && factura.sucursal_nombre);
  return {
    NOMBRE: nombre || 'Cliente',
    FACTURA: factura.numero_factura || '-',
    TIENDA: factura.tienda || '-',
    TRACKING: factura.numero_tracking || '-',
    MONTO: Number(factura.total || 0).toFixed(2),
    SUCURSAL_NOMBRE: tieneSucursal ? factura.sucursal_nombre : 'Cualquiera de nuestras sucursales',
    SUCURSAL_DIRECCION: tieneSucursal
      ? (factura.sucursal_direccion || '-')
      : 'Escríbenos y te indicamos la más cercana.',
    SUCURSAL_HORARIO: tieneSucursal ? (factura.sucursal_horario || '-') : 'Lun a Vie',
    SUCURSAL_TELEFONO: tieneSucursal ? (factura.sucursal_telefono || '-') : '-',
  };
}

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
  return enviarConTemplate(
    destinatario,
    `Factura ${factura.numero_factura} — NEA Cargo Xpress`,
    TEMPLATE_FACTURA,
    variablesFactura(nombre, factura),
    factura.numero_factura,
    pdfBuffer
  );
}

async function enviarCorreoCambioEstado(destinatario, nombre, paquete) {
  const ESTADOS_QUE_NOTIFICAN = ['en_bodega_miami', 'listo_para_retiro'];
  if (!ESTADOS_QUE_NOTIFICAN.includes(paquete.estado)) return;
  const etiqueta = ESTADO_LABEL[paquete.estado] || paquete.estado;
  const mensaje = ESTADO_MENSAJE[paquete.estado] || `Tu paquete cambió de estado a: ${etiqueta}.`;
  const esRetiro = paquete.estado === 'listo_para_retiro';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>¡Hola, ${nombre}!</h2>
      <p>${mensaje}</p>
      <div style="background:#f5f6f8;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 6px;"><strong>${paquete.tienda}</strong></p>
        <p style="margin:0 0 6px;color:#6b7280;">Tracking: ${paquete.numero_tracking}</p>
        <p style="margin:0;"><span style="background:#ff6a1a;color:#fff;padding:4px 10px;border-radius:20px;font-size:12px;">${etiqueta}</span></p>
      </div>
      ${esRetiro ? bloqueSucursal(paquete) : ''}
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
  return enviarConTemplate(
    destinatario,
    `Tu paquete está listo para retiro — Factura ${factura.numero_factura} — NEA Cargo Xpress`,
    TEMPLATE_FACTURA,
    variablesFactura(nombre, factura),
    factura.numero_factura,
    pdfBuffer
  );
}

/** Envío usando un template publicado en Resend, con PDF adjunto opcional */
async function enviarConTemplate(destinatario, asunto, templateId, variables, nombreArchivo, pdfBuffer) {
  const cuerpo = {
    from: process.env.EMAIL_FROM || 'NEA Cargo Xpress <onboarding@resend.dev>',
    to: destinatario,
    subject: asunto,
    template: { id: templateId, variables },
  };
  if (pdfBuffer) {
    cuerpo.attachments = [{ filename: `${nombreArchivo}.pdf`, content: pdfBuffer.toString('base64') }];
  }
  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!respuesta.ok) { const d = await respuesta.text(); throw new Error(`Resend respondió ${respuesta.status}: ${d}`); }
  return respuesta.json();
}

/** Envío con PDF adjunto (HTML directo, sin template) */
async function enviarConAdjunto(destinatario, asunto, html, nombreArchivo, pdfBuffer) {
  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'NEA Cargo Xpress <onboarding@resend.dev>',
      to: destinatario,
      subject: asunto,
      html,
      attachments: [{ filename: `${nombreArchivo}.pdf`, content: pdfBuffer.toString('base64') }],
    }),
  });
  if (!respuesta.ok) { const d = await respuesta.text(); throw new Error(`Resend respondió ${respuesta.status}: ${d}`); }
  return respuesta.json();
}

/** Envío genérico sin adjuntos */
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
