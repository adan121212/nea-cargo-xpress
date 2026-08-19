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
<div style="background:#f4f4f1;padding:24px 0;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">

    <div style="background:#0c1b33;padding:20px 24px">
      <p style="margin:0;color:#ff6a1a;font-size:13px;letter-spacing:2px;font-weight:bold">NEA CARGO XPRESS</p>
    </div>

    <div style="padding:24px">
      <h1 style="margin:0 0 6px;font-size:20px;color:#0c1b33">Bienvenido, ${escapar(nom)}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#444444;line-height:1.6">
        Ya puedes comprar en tiendas de Estados Unidos y recibir tus paquetes
        con nosotros. Esta es tu direcci&oacute;n de env&iacute;o:
      </p>

      <div style="border:2px solid #0c1b33;border-radius:8px;padding:16px 18px;background:#fafafa">
        <pre style="margin:0;font-family:'Courier New',Courier,monospace;font-size:15px;line-height:1.7;color:#0c1b33;white-space:pre-wrap">${escapar(bloqueDireccion)}</pre>
      </div>

      <p style="margin:16px 0 20px;font-size:14px;color:#666666;line-height:1.6">
        C&oacute;piala tal cual al momento de pagar en la tienda.
      </p>

      <div style="border-left:4px solid #ff6a1a;background:#fff6f0;padding:12px 14px">
        <p style="margin:0;font-size:14px;color:#7a3410;line-height:1.6">
          <b>Importante:</b> el nombre debe ir exactamente como aparece arriba.
          Todos nuestros clientes comparten la misma bodega, y tu nombre junto al
          ${BODEGA.casillero} es lo que identifica que el paquete es tuyo. Si compras
          a nombre de otra persona o con un apodo, el paquete puede llegar sin due&ntilde;o.
        </p>
      </div>

      <p style="margin:20px 0 0;font-size:14px;color:#444444;line-height:1.6">
        Tu c&oacute;digo de cliente es <b style="font-family:'Courier New',monospace">${escapar(codigo)}</b>.
        <b>No va en la direcci&oacute;n</b> &mdash; es el n&uacute;mero con el que te
        identificamos cuando escribes o preguntas por un paquete.
      </p>

      <p style="margin:20px 0 0;font-size:14px;color:#666666;line-height:1.6">
        Cualquier duda, responde este mismo correo.
      </p>
    </div>

  </div>
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
