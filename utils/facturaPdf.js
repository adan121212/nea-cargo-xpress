const PDFDocument = require('pdfkit');

/**
 * Genera el PDF de una factura y lo devuelve como Buffer.
 * `factura` debe traer también: cliente_nombre, cliente_apellido, cliente_email,
 * numero_casillero, tienda, numero_tracking (los trae el JOIN de las consultas).
 */
function generarPdfFactura(factura) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const naranja = '#ff6a1a';
    const tinta = '#0c1b33';
    const gris = '#6b7280';

    // Encabezado
    doc
      .fillColor(tinta)
      .fontSize(20)
      .text('NEA CARGO XPRESS', 50, 50, { continued: false })
      .fontSize(9)
      .fillColor(gris)
      .text('Miami → Panamá', 50, 74);

    doc
      .fillColor(naranja)
      .fontSize(16)
      .text(factura.numero_factura || `FAC-${String(factura.id).padStart(6, '0')}`, 50, 100);

    doc
      .fillColor(gris)
      .fontSize(9)
      .text(
        `Fecha: ${new Date(factura.fecha_creacion).toLocaleDateString('es-PA', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })}`,
        50,
        122
      );

    doc.moveTo(50, 145).lineTo(545, 145).strokeColor('#e5e7eb').stroke();

    // Datos del cliente
    doc.fillColor(tinta).fontSize(11).text('Facturado a:', 50, 165);
    doc
      .fillColor(gris)
      .fontSize(10)
      .text(`${factura.cliente_nombre || ''} ${factura.cliente_apellido || ''}`, 50, 182)
      .text(factura.cliente_email || '', 50, 197)
      .text(`Casillero: ${factura.numero_casillero || '—'}`, 50, 212);

    // Datos del paquete
    doc.fillColor(tinta).fontSize(11).text('Paquete:', 320, 165);
    doc
      .fillColor(gris)
      .fontSize(10)
      .text(`Tienda: ${factura.tienda || '—'}`, 320, 182)
      .text(`Tracking: ${factura.numero_tracking || '—'}`, 320, 197)
      .text(`Peso facturado: ${factura.peso_facturado_lb} lb`, 320, 212);

    // Tabla de conceptos
    let y = 260;
    doc.fillColor(tinta).fontSize(11).text('Detalle', 50, y);
    y += 22;

    const fila = (label, valor, negrita = false) => {
      doc
        .fontSize(10)
        .fillColor(negrita ? tinta : gris)
        .text(label, 50, y, { continued: false });
      doc.text(`$${Number(valor).toFixed(2)}`, 0, y, { align: 'right' });
      y += 20;
    };

    doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor('#e5e7eb').stroke();
    fila(`Costo de envío (${factura.peso_facturado_lb} lb x $${factura.precio_libra}/lb)`, factura.costo_envio);
    fila('Cargo de manejo', factura.cargo_manejo);
    fila('Seguro', factura.seguro);

    doc.moveTo(50, y).lineTo(545, y).strokeColor(tinta).stroke();
    y += 10;

    doc.fontSize(13).fillColor(tinta).text('TOTAL', 50, y, { continued: false });
    doc.fontSize(13).fillColor(naranja).text(`$${Number(factura.total).toFixed(2)}`, 0, y, { align: 'right' });

    y += 40;
    doc
      .fontSize(9)
      .fillColor(gris)
      .text(
        `Estado: ${factura.estado === 'pagada' ? 'Pagada' : factura.estado === 'anulada' ? 'Anulada' : 'Pendiente de pago'}`,
        50,
        y
      );

    doc
      .fontSize(8)
      .fillColor(gris)
      .text('NEA Cargo Xpress — Gracias por tu preferencia.', 50, 780, { align: 'center', width: 495 });

    doc.end();
  });
}

module.exports = { generarPdfFactura };
