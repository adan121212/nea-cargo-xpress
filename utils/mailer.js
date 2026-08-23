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
  const baseUrl = process.env.BASE_URL || '';
  const html = `
  <div style="background:#eceef1;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#f4f5f7;border-radius:14px;overflow:hidden;">
      <tr><td style="background:#0c1b33;padding:24px 22px;text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
          <td style="vertical-align:middle;padding-right:10px;">
            <div style="width:38px;height:38px;border-radius:9px;background:#ff6a1a;color:#ffffff;font-weight:bold;font-size:21px;line-height:38px;text-align:center;">N</div>
          </td>
          <td style="vertical-align:middle;text-align:left;">
            <div style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:0.5px;">NEA CARGO XPRESS</div>
            <div style="color:#8ea0bd;font-size:9px;letter-spacing:2px;margin-top:3px;">MAR&Iacute;TIMA &middot; A&Eacute;REA &middot; TERRESTRE</div>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="height:4px;background:#ff6a1a;line-height:4px;font-size:0;">&nbsp;</td></tr>
      <tr><td style="padding:26px 24px;">
        <span style="display:inline-block;background:#ffe6d6;color:#e2570e;font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:5px 12px;border-radius:20px;margin-bottom:16px;">Nuevo registro</span>
        <h1 style="font-size:20px;color:#0c1b33;margin:0 0 6px;">Nuevo cliente registrado</h1>
        <p style="font-size:13px;color:#6b7280;margin:0 0 22px;line-height:1.5;">Se acaba de crear un casillero nuevo en la plataforma.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;">
          <tr><td style="padding:16px 18px;">
            <div style="font-size:17px;font-weight:bold;color:#0c1b33;padding-bottom:12px;">${usuario.nombre} ${usuario.apellido}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
              <tr><td style="color:#9ca3af;padding:4px 0;">Correo</td><td style="color:#374151;text-align:right;padding:4px 0;">${usuario.email}</td></tr>
              ${usuario.telefono ? `<tr><td style="color:#9ca3af;padding:4px 0;">Tel&eacute;fono</td><td style="color:#374151;text-align:right;padding:4px 0;">${usuario.telefono}</td></tr>` : ''}
              <tr><td style="color:#9ca3af;padding:4px 0;">Casillero</td><td style="text-align:right;padding:4px 0;"><span style="background:#0c1b33;color:#ffffff;font-size:12px;font-family:monospace;padding:3px 9px;border-radius:5px;">${usuario.numero_casillero}</span></td></tr>
            </table>
          </td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:#fff8f3;border-left:3px solid #ff6a1a;border-radius:6px;">
          <tr><td style="padding:12px 14px;font-size:12.5px;color:#92400e;">&#9203; Todav&iacute;a debe confirmar su correo antes de poder iniciar sesi&oacute;n.</td></tr>
        </table>
      </td></tr>
      <tr><td style="background:#0c1b33;padding:20px 22px;text-align:center;">
        <div style="color:#ffffff;font-size:12px;font-weight:bold;margin-bottom:6px;">NEA Cargo Xpress</div>
        <div style="color:#8ea0bd;font-size:10.5px;margin-bottom:3px;">Miami &rarr; Panam&aacute; &middot; Tu casillero en EE.UU.</div>
        <div style="color:#8ea0bd;font-size:10.5px;">${baseUrl ? baseUrl.replace(/^https?:\/\//, '') : 'neacargoxpress.com'}</div>
      </td></tr>
    </table>
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
