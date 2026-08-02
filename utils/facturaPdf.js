const PDFDocument = require('pdfkit');

/**
 * Genera el PDF de una factura y lo devuelve como Buffer.
 * `factura` debe traer también: cliente_nombre, cliente_apellido, cliente_email,
 * numero_casillero, tienda, numero_tracking (los trae el JOIN de las consultas),
 * y opcionalmente firma_base64 / fecha_entrega (si el paquete ya fue entregado y firmado).
 */
function generarPdfFactura(factura) {
  // La firma se guarda directo en la base de datos como data URL
  // ("data:image/png;base64,...") — solo hay que decodificarla, sin red de por medio.
  let firmaBuffer = null;
  if (factura.firma_base64) {
    try {
      const base64Limpio = factura.firma_base64.replace(/^data:image\/png;base64,/, '');
      firmaBuffer = Buffer.from(base64Limpio, 'base64');
    } catch (error) {
      console.error('No se pudo decodificar la firma para el PDF:', error);
    }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ---------- Paleta de marca ----------
    const TINTA = '#0c1b33';
    const NARANJA = '#ff6a1a';
    const NARANJA_OSC = '#e2570e';
    const GRIS = '#6b7280';
    const GRIS_CLARO = '#9aa3b2';
    const LINEA = '#e4e7ec';
    const PAPEL = '#f5f6f8';
    const VERDE = '#177a63';
    const VERDE_BG = '#e7f3f0';
    const AMBAR_BG = '#fff1e8';

    const MARGEN_IZQ = 50;
    const MARGEN_DER = 545;
    const ANCHO_CONTENIDO = MARGEN_DER - MARGEN_IZQ;

    const money = (n) => `$${Number(n || 0).toFixed(2)}`;
    const fechaLarga = (d) =>
      new Date(d).toLocaleDateString('es-PA', { day: '2-digit', month: 'long', year: 'numeric' });

    // ============ BANDA SUPERIOR (marca) ============
    doc.rect(0, 0, 595, 118).fill(TINTA);

    // Marca cuadrada tipo "logo"
    doc.roundedRect(MARGEN_IZQ, 34, 34, 34, 7).fill(NARANJA);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(TINTA).text('N', MARGEN_IZQ, 43, { width: 34, align: 'center' });

    doc
      .font('Helvetica-Bold').fontSize(15).fillColor('#ffffff')
      .text('NEA CARGO XPRESS', MARGEN_IZQ + 44, 38);
    doc
      .font('Helvetica').fontSize(8.5).fillColor('#aab3c4')
      .text('MIAMI  →  PANAMÁ', MARGEN_IZQ + 44, 58, { characterSpacing: 0.6 });

    // Número de factura + fecha, alineado a la derecha
    doc
      .font('Helvetica-Bold').fontSize(20).fillColor(NARANJA)
      .text(factura.numero_factura || `FAC-${String(factura.id).padStart(6, '0')}`, 300, 36, {
        width: 245, align: 'right',
      });
    doc
      .font('Helvetica').fontSize(9).fillColor('#c7ccd6')
      .text(`Emitida el ${fechaLarga(factura.fecha_creacion)}`, 300, 62, { width: 245, align: 'right' });

    // Badge de estado
    const estadoInfo = {
      pagada: { texto: 'PAGADA', color: VERDE, bg: '#dff0ec' },
      pendiente: { texto: 'PENDIENTE DE PAGO', color: NARANJA_OSC, bg: '#ffe2cf' },
      anulada: { texto: 'ANULADA', color: '#9aa3b2', bg: '#e9ebef' },
    }[factura.estado] || { texto: factura.estado, color: '#9aa3b2', bg: '#e9ebef' };

    const badgeAncho = doc.font('Helvetica-Bold').fontSize(9).widthOfString(estadoInfo.texto) + 24;
    doc.roundedRect(545 - badgeAncho, 84, badgeAncho, 20, 10).fill(estadoInfo.bg);
    doc
      .font('Helvetica-Bold').fontSize(9).fillColor(estadoInfo.color)
      .text(estadoInfo.texto, 545 - badgeAncho, 90, { width: badgeAncho, align: 'center' });

    // ============ TARJETAS: cliente + paquete ============
    let y = 148;
    const anchoTarjeta = (ANCHO_CONTENIDO - 14) / 2;

    doc.roundedRect(MARGEN_IZQ, y, anchoTarjeta, 90, 8).fillAndStroke(PAPEL, PAPEL);
    doc.roundedRect(MARGEN_IZQ + anchoTarjeta + 14, y, anchoTarjeta, 90, 8).fillAndStroke(PAPEL, PAPEL);

    const colB = MARGEN_IZQ + anchoTarjeta + 14;

    doc.font('Helvetica-Bold').fontSize(9).fillColor(NARANJA_OSC)
      .text('FACTURADO A', MARGEN_IZQ + 16, y + 14, { characterSpacing: 0.4 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TINTA)
      .text(`${factura.cliente_nombre || ''} ${factura.cliente_apellido || ''}`, MARGEN_IZQ + 16, y + 30);
    doc.font('Helvetica').fontSize(9).fillColor(GRIS)
      .text(factura.cliente_email || '', MARGEN_IZQ + 16, y + 47)
      .text(`Casillero: ${factura.numero_casillero || '—'}`, MARGEN_IZQ + 16, y + 62);

    doc.font('Helvetica-Bold').fontSize(9).fillColor(NARANJA_OSC)
      .text('PAQUETE', colB + 16, y + 14, { characterSpacing: 0.4 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TINTA)
      .text(factura.tienda || '—', colB + 16, y + 30);
    doc.font('Helvetica').fontSize(9).fillColor(GRIS)
      .text(`Tracking: ${factura.numero_tracking || '—'}`, colB + 16, y + 47)
      .text(`Peso facturado: ${factura.peso_facturado_lb} lb`, colB + 16, y + 62);

    // ============ TABLA DE CONCEPTOS ============
    y += 90 + 30;

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(TINTA).text('Detalle de cargos', MARGEN_IZQ, y);
    y += 22;

    // Encabezado de tabla
    doc.rect(MARGEN_IZQ, y, ANCHO_CONTENIDO, 24).fill(TINTA);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
      .text('CONCEPTO', MARGEN_IZQ + 12, y + 8)
      .text('MONTO', MARGEN_IZQ, y + 8, { width: ANCHO_CONTENIDO - 12, align: 'right' });
    y += 24;

    const filaConcepto = (label, valor, i) => {
      const alturaFila = 26;
      if (i % 2 === 1) {
        doc.rect(MARGEN_IZQ, y, ANCHO_CONTENIDO, alturaFila).fill(PAPEL);
      }
      doc.font('Helvetica').fontSize(9.5).fillColor(GRIS)
        .text(label, MARGEN_IZQ + 12, y + 8, { width: ANCHO_CONTENIDO - 130 });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TINTA)
        .text(money(valor), MARGEN_IZQ, y + 8, { width: ANCHO_CONTENIDO - 12, align: 'right' });
      y += alturaFila;
    };

    filaConcepto(`Costo de envío  (${factura.peso_facturado_lb} lb × $${factura.precio_libra}/lb)`, factura.costo_envio, 0);
    filaConcepto('Cargo de manejo', factura.cargo_manejo, 1);
    filaConcepto('Seguro', factura.seguro, 2);

    doc.moveTo(MARGEN_IZQ, y).lineTo(MARGEN_DER, y).strokeColor(LINEA).lineWidth(1).stroke();

    // ============ TOTAL ============
    y += 14;
    const totalAncho = 200;
    doc.roundedRect(MARGEN_DER - totalAncho, y, totalAncho, 40, 8).fill(TINTA);
    doc.font('Helvetica').fontSize(9.5).fillColor('#c7ccd6')
      .text('TOTAL A PAGAR', MARGEN_DER - totalAncho + 16, y + 9);
    doc.font('Helvetica-Bold').fontSize(17).fillColor(NARANJA)
      .text(money(factura.total), MARGEN_DER - totalAncho, y + 22, { width: totalAncho - 16, align: 'right' });

    y += 40 + 34;

    // ============ FIRMA DE RECIBIDO ============
    if (firmaBuffer) {
      doc.roundedRect(MARGEN_IZQ, y, ANCHO_CONTENIDO, 130, 8).strokeColor(LINEA).lineWidth(1).stroke();

      doc.font('Helvetica-Bold').fontSize(10).fillColor(VERDE)
        .text('✓  FIRMA DE RECIBIDO', MARGEN_IZQ + 16, y + 14, { characterSpacing: 0.3 });

      try {
        doc.roundedRect(MARGEN_IZQ + 16, y + 34, 200, 78, 6).fillAndStroke('#ffffff', LINEA);
        doc.image(firmaBuffer, MARGEN_IZQ + 24, y + 40, { fit: [184, 62] });
      } catch (error) {
        console.error('No se pudo incrustar la imagen de la firma en el PDF:', error);
      }

      const fechaEntregaTxt = factura.fecha_entrega
        ? `Entregado el ${fechaLarga(factura.fecha_entrega)} a las ${new Date(factura.fecha_entrega).toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' })}`
        : 'Paquete entregado';

      doc.font('Helvetica').fontSize(9).fillColor(GRIS)
        .text(fechaEntregaTxt, MARGEN_IZQ + 240, y + 44, { width: ANCHO_CONTENIDO - 260 });
      doc.font('Helvetica').fontSize(8).fillColor(GRIS_CLARO)
        .text('El cliente firmó digitalmente al momento de recibir el paquete en mostrador, confirmando conformidad con el contenido y estado del envío.', MARGEN_IZQ + 240, y + 60, { width: ANCHO_CONTENIDO - 260 });

      y += 130 + 24;
    }

    // ============ PIE DE PÁGINA ============
    doc.moveTo(MARGEN_IZQ, 760).lineTo(MARGEN_DER, 760).strokeColor(LINEA).lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TINTA)
      .text('NEA Cargo Xpress', MARGEN_IZQ, 772);
    doc.font('Helvetica').fontSize(8).fillColor(GRIS_CLARO)
      .text('Gracias por tu preferencia · Miami → Panamá', MARGEN_IZQ, 786);
    doc.font('Helvetica').fontSize(8).fillColor(GRIS_CLARO)
      .text('Documento generado automáticamente', 0, 772, { width: MARGEN_DER, align: 'right' });

    doc.end();
  });
}

module.exports = { generarPdfFactura };
