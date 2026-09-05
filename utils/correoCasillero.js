// utils/correoCasillero.js
// Correo de bienvenida: le manda al cliente su direccion de Miami al registrarse.
//
// OJO con la diferencia entre los dos numeros:
//   PTY-14981      = casillero real de la agencia. Va en la direccion. Igual para todos.
//   codigoCliente  = codigo interno del cliente (PTY-00008). NO va en la direccion.

const BODEGA = {
  casillero: 'PTY-14981',
  empresa: 'NEA CARGO XPRESS',
  calle: '8610 NW 72 Street',
  ciudad: 'Miami, FL 33195',
  telefono: '1-305-406-3654',
};

// Evita que un nombre con < o & rompa el HTML del correo.
function escapar(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;',
  }[c]));
}

/**
 * @param {string} email          correo del cliente
 * @param {string} nombre         nombre completo o razon social, como se registro
 * @param {string} codigoCliente  el numero_casillero interno (PTY-00008)
 */
async function enviarCorreoCasillero(email, nombre, codigoCliente) {
  const nom = String(nombre || '').trim();
  const codigo = String(codigoCliente || '').trim();

  const bloqueDireccion =
    `${BODEGA.casillero} ${nom}\n` +
    `${BODEGA.empresa}\n` +
    `${BODEGA.calle}\n` +
    `${BODEGA.casillero}\n` +
    `${BODEGA.ciudad}\n` +
    `Tel: ${BODEGA.telefono}`;

  const html = `
<div style="background:#eceef1;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#f4f5f7;border-radius:14px;overflow:hidden">

    <tr><td style="background:#0c1b33;padding:24px 22px;text-align:center">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>
        <td style="vertical-align:middle;padding-right:10px">
          <div style="width:38px;height:38px;border-radius:9px;background:#ff6a1a;color:#ffffff;font-weight:bold;font-size:21px;line-height:38px;text-align:center">N</div>
        </td>
        <td style="vertical-align:middle;text-align:left">
          <div style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:0.5px">NEA CARGO XPRESS</div>
          <div style="color:#8ea0bd;font-size:9px;letter-spacing:2px;margin-top:3px">MAR&Iacute;TIMA &middot; A&Eacute;REA &middot; TERRESTRE</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="height:4px;background:#ff6a1a;line-height:4px;font-size:0">&nbsp;</td></tr>

    <tr><td style="padding:26px 24px">
      <h1 style="margin:0 0 8px;font-size:22px;color:#0c1b33">&iexcl;Bienvenido, ${escapar(nom)}! &#128230;</h1>
      <p style="margin:0 0 22px;font-size:14px;color:#555555;line-height:1.6">
        Ya puedes comprar en tiendas de Estados Unidos y recibir tus paquetes con nosotros. Esta es tu direcci&oacute;n de env&iacute;o &mdash; c&oacute;piala tal cual al pagar en la tienda:
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:2px dashed #ff6a1a;border-radius:10px">
        <tr><td style="padding:18px 20px">
          <div style="font-size:10px;font-weight:bold;color:#e2570e;text-transform:uppercase;letter-spacing:1px;text-align:center;margin-bottom:12px">&#128205; Tu direcci&oacute;n en Miami</div>
          <pre style="margin:0;font-family:'Courier New',Courier,monospace;font-size:15px;line-height:1.8;color:#0c1b33;white-space:pre-wrap">${escapar(bloqueDireccion)}</pre>
        </td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;background:#fff6f0;border-left:4px solid #ff6a1a;border-radius:6px">
        <tr><td style="padding:13px 15px;font-size:13px;color:#7a3410;line-height:1.6">
          <b>Importante:</b> el nombre debe ir exactamente como aparece arriba. Todos nuestros clientes comparten la misma bodega, y tu nombre junto al ${BODEGA.casillero} es lo que identifica que el paquete es tuyo. Si compras a nombre de otra persona o con un apodo, el paquete puede llegar sin due&ntilde;o.
        </td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px">
        <tr><td style="text-align:center;font-size:11px;font-weight:bold;color:#0c1b33;text-transform:uppercase;letter-spacing:1px;padding-bottom:14px">&iquest;C&oacute;mo funciona?</td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#374151">
        <tr>
          <td style="width:28px;vertical-align:top;padding:5px 0"><div style="width:22px;height:22px;background:#ff6a1a;color:#fff;border-radius:50%;text-align:center;line-height:22px;font-size:12px;font-weight:bold">1</div></td>
          <td style="padding:5px 0;line-height:1.5">Compra en Amazon, eBay, Shein... usando tu direcci&oacute;n de arriba.</td>
        </tr>
        <tr>
          <td style="width:28px;vertical-align:top;padding:5px 0"><div style="width:22px;height:22px;background:#ff6a1a;color:#fff;border-radius:50%;text-align:center;line-height:22px;font-size:12px;font-weight:bold">2</div></td>
          <td style="padding:5px 0;line-height:1.5">Recibimos tu paquete en Miami y lo enviamos a Panam&aacute;.</td>
        </tr>
        <tr>
          <td style="width:28px;vertical-align:top;padding:5px 0"><div style="width:22px;height:22px;background:#ff6a1a;color:#fff;border-radius:50%;text-align:center;line-height:22px;font-size:12px;font-weight:bold">3</div></td>
          <td style="padding:5px 0;line-height:1.5">Lo retiras en tu sucursal m&aacute;s cercana.</td>
        </tr>
      </table>

      <p style="margin:22px 0 0;font-size:13px;color:#666666;line-height:1.6">
        Tu c&oacute;digo de cliente es <b style="font-family:'Courier New',monospace;color:#0c1b33">${escapar(codigo)}</b>. <b>No va en la direcci&oacute;n</b> &mdash; es el n&uacute;mero con el que te identificamos cuando escribes o preguntas por un paquete.
      </p>
    </td></tr>

    <tr><td style="background:#0c1b33;padding:20px 22px;text-align:center">
      <div style="color:#ffffff;font-size:12px;font-weight:bold;margin-bottom:6px">NEA Cargo Xpress</div>
      <div style="color:#8ea0bd;font-size:10.5px;margin-bottom:3px">Miami &rarr; Panam&aacute; &middot; Cualquier duda, responde este correo</div>
      <div style="color:#8ea0bd;font-size:10.5px">neacargoxpress.com</div>
    </td></tr>

  </table>
</div>`;

  const texto =
    `Bienvenido, ${nom}\n\n` +
    `Ya puedes comprar en tiendas de Estados Unidos y recibir tus paquetes con nosotros.\n` +
    `Esta es tu direccion de envio:\n\n` +
    bloqueDireccion + `\n\n` +
    `Copiala tal cual al momento de pagar en la tienda.\n\n` +
    `IMPORTANTE: el nombre debe ir exactamente como aparece arriba. Todos nuestros\n` +
    `clientes comparten la misma bodega, y tu nombre junto al ${BODEGA.casillero} es lo\n` +
    `que identifica que el paquete es tuyo. Si compras a nombre de otra persona o\n` +
    `con un apodo, el paquete puede llegar sin dueno.\n\n` +
    `Tu codigo de cliente es ${codigo}. No va en la direccion: es el numero con el\n` +
    `que te identificamos cuando escribes o preguntas por un paquete.\n\n` +
    `Cualquier duda, responde este mismo correo.`;

  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'NEA Cargo Xpress <no-reply@neacargoxpress.com>',
      to: [email],
      subject: 'Tu direcci\u00f3n en Miami \u2014 NEA Cargo Xpress',
      html,
      text: texto,
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`Resend respondio ${respuesta.status}: ${detalle}`);
  }
}

module.exports = { enviarCorreoCasillero };
