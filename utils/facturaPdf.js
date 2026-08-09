const PDFDocument = require('pdfkit');

// ── Colores de marca NEA Cargo Xpress ──────────────────────────────────────
const NAVY   = '#0c1b33';
const ORANGE = '#ff6a1a';
const GRAY   = '#6b7280';
const LIGHT  = '#f1f3f2';
const LINE   = '#e5e7eb';
const WHITE  = '#ffffff';

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt$(n){ return `$${Number(n || 0).toFixed(2)}`; }

function fmtFecha(d){
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-PA', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function estadoLabel(estado){
  const labels = {
    pendiente: 'Pendiente de pago',
    pagada:    'Pagada',
    anulada:   'Anulada',
  };
  return labels[estado] || estado;
}

// Dibuja un rectángulo con esquinas redondeadas (PDFKit no tiene roundedRect nativo en v0.15)
function roundRect(doc, x, y, w, h, r, fillColor, strokeColor){
  doc.save();
  doc.roundedRect(x, y, w, h, r);
  if (fillColor)   { doc.fillColor(fillColor); doc.fill(); }
  if (strokeColor) { doc.strokeColor(strokeColor); doc.stroke(); }
  doc.restore();
}

// ── Función principal ──────────────────────────────────────────────────────
/**
 * Genera el PDF de una factura de NEA Cargo Xpress.
 * @param {Object} factura  Fila combinada de facturas + usuarios + paquetes.
 * @returns {Promise<Buffer>}
 */
async function generarPdfFactura(factura) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 40, bottom: 40, left: 50, right: 50 },
        info: {
          Title:  `Factura ${factura.numero_factura}`,
          Author: 'NEA Cargo Xpress',
        },
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width - 100;  // ancho útil
      const LM = 50;                    // margen izquierdo

      // ══════════════════════════════════════════════════════════════════
      // CABECERA
      // ══════════════════════════════════════════════════════════════════
      // Bloque navy de fondo
      doc.rect(0, 0, doc.page.width, 110).fill(NAVY);

      // Logo: cuadrado naranja con "N"
      doc.roundedRect(LM, 20, 60, 60, 8).fill(ORANGE);
      doc.font('Helvetica-Bold').fontSize(28).fillColor(NAVY)
         .text('N', LM, 36, { width: 60, align: 'center' });

      // Nombre de la empresa
      doc.font('Helvetica-Bold').fontSize(18).fillColor(WHITE)
         .text('NEA CARGO XPRESS', LM + 72, 28);
      doc.font('Helvetica').fontSize(9).fillColor('#94a3b8')
         .text('Miami → Panamá · Casillero Virtual', LM + 72, 50);

      // Etiqueta FACTURA + número
      const estado = factura.estado || 'pendiente';
      const colorEstado = estado === 'pagada' ? '#22c55e' : estado === 'anulada' ? '#ef4444' : ORANGE;
      doc.font('Helvetica-Bold').fontSize(22).fillColor(WHITE)
         .text('FACTURA', 0, 22, { width: doc.page.width - 50, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(13).fillColor(ORANGE)
         .text(factura.numero_factura || '—', 0, 48, { width: doc.page.width - 50, align: 'right' });
      // Badge de estado
      const badgeText = estadoLabel(estado).toUpperCase();
      const badgeW = 110, badgeH = 20, badgeX = doc.page.width - 50 - badgeW, badgeY = 68;
      doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 4).fill(colorEstado);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(WHITE)
         .text(badgeText, badgeX, badgeY + 5, { width: badgeW, align: 'center' });

      doc.y = 130;

      // ══════════════════════════════════════════════════════════════════
      // DATOS: Cliente y Fechas lado a lado
      // ══════════════════════════════════════════════════════════════════
      const colW = (W - 20) / 2;

      // Bloque cliente
      roundRect(doc, LM, doc.y, colW, 115, 6, LIGHT, LINE);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE)
         .text('DATOS DEL CLIENTE', LM + 12, doc.y + 12);
      const clienteY = doc.y + 26;
      const nombreCliente = `${factura.cliente_nombre || ''} ${factura.cliente_apellido || ''}`.trim();
      doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY)
         .text(nombreCliente, LM + 12, clienteY, { width: colW - 24 });
      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
         .text(factura.cliente_email || '—', LM + 12, clienteY + 16, { width: colW - 24 })
         .text(`Casillero: ${factura.numero_casillero || '—'}`, LM + 12, clienteY + 30)
         .text(`Teléfono: ${factura.cliente_telefono || 'No registrado'}`, LM + 12, clienteY + 44)
         .text(`Retiro autorizado: ${factura.firma_base64 ? 'Firma digital adjunta' : 'Pendiente'}`, LM + 12, clienteY + 58);

      // Bloque fechas
      const bX2 = LM + colW + 20;
      roundRect(doc, bX2, doc.y - 115, colW, 115, 6, LIGHT, LINE);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE)
         .text('INFORMACIÓN DE LA FACTURA', bX2 + 12, doc.y - 115 + 12);
      const filaFecha = (label, valor, offsetY) => {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY)
           .text(label, bX2 + 12, doc.y - 115 + 26 + offsetY);
        doc.font('Helvetica').fontSize(9).fillColor(NAVY)
           .text(valor, bX2 + 12, doc.y - 115 + 36 + offsetY, { width: colW - 24 });
      };
      filaFecha('Fecha de emisión',   fmtFecha(factura.fecha_creacion), 0);
      filaFecha('Fecha de pago',      fmtFecha(factura.fecha_pago),     26);
      filaFecha('Fecha de entrega',   fmtFecha(factura.fecha_entrega),  52);
      filaFecha('Método de pago',     factura.metodo_pago ? factura.metodo_pago.charAt(0).toUpperCase() + factura.metodo_pago.slice(1) : 'Pendiente', 78);

      doc.y += 20;

      // ══════════════════════════════════════════════════════════════════
      // DETALLE DEL PAQUETE
      // ══════════════════════════════════════════════════════════════════
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE)
         .text('DETALLE DEL ENVÍO', LM, doc.y);
      doc.moveDown(0.3);

      // Encabezado de tabla
      const tableTop = doc.y;
      doc.rect(LM, tableTop, W, 22).fill(NAVY);
      const cols = [
        { label: 'DESCRIPCIÓN',      x: LM + 10,       w: W * 0.38 },
        { label: 'TRACKING',         x: LM + W * 0.40, w: W * 0.28 },
        { label: 'PESO (LB)',        x: LM + W * 0.70, w: W * 0.14 },
        { label: 'VALOR DECLARADO', x: LM + W * 0.85, w: W * 0.14 },
      ];
      cols.forEach(col => {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE)
           .text(col.label, col.x, tableTop + 7, { width: col.w, align: 'left' });
      });

      // Fila de datos del paquete
      const rowY = tableTop + 22;
      doc.rect(LM, rowY, W, 28).fill(WHITE).stroke(LINE);
      const cellData = [
        factura.tienda || '—',
        factura.numero_tracking || '—',
        `${Number(factura.peso_facturado_lb || 0).toFixed(2)} lb`,
        fmt$(factura.valor_declarado),
      ];
      cols.forEach((col, i) => {
        doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(NAVY)
           .text(cellData[i], col.x, rowY + 8, { width: col.w - 5 });
      });

      doc.y = rowY + 28 + 18;

      // ══════════════════════════════════════════════════════════════════
      // DESGLOSE DE COBROS
      // ══════════════════════════════════════════════════════════════════
      doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE)
         .text('DESGLOSE DE COBROS', LM, doc.y);
      doc.moveDown(0.3);

      const desglose = [
        [`Flete (${Number(factura.peso_facturado_lb || 0).toFixed(2)} lb × $${Number(factura.precio_libra || 0).toFixed(2)}/lb)`, fmt$(factura.costo_envio)],
        ['Cargo de manejo', fmt$(factura.cargo_manejo)],
        ['Seguro (sobre valor declarado)', fmt$(factura.seguro)],
      ];

      const desgloseTop = doc.y;
      const dW = 360;
      const dX = LM + W - dW;

      desglose.forEach(([label, valor], i) => {
        const dy = desgloseTop + i * 22;
        if (i % 2 === 0) doc.rect(dX, dy, dW, 22).fill('#f9fafb');
        doc.font('Helvetica').fontSize(9.5).fillColor(GRAY)
           .text(label, dX + 10, dy + 6);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY)
           .text(valor, dX, dy + 6, { width: dW - 10, align: 'right' });
      });

      // Línea divisoria
      const totalY = desgloseTop + desglose.length * 22 + 6;
      doc.moveTo(dX, totalY).lineTo(dX + dW, totalY).strokeColor(ORANGE).lineWidth(1.5).stroke();

      // Total
      doc.rect(dX, totalY + 2, dW, 30).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#94a3b8')
         .text('TOTAL A PAGAR', dX + 10, totalY + 10);
      doc.font('Helvetica-Bold').fontSize(16).fillColor(ORANGE)
         .text(fmt$(factura.total), dX, totalY + 8, { width: dW - 10, align: 'right' });

      doc.y = totalY + 46;

      // ══════════════════════════════════════════════════════════════════
      // FIRMA DIGITAL (si existe)
      // ══════════════════════════════════════════════════════════════════
      if (factura.firma_base64) {
        doc.moveDown(0.8);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE)
           .text('FIRMA DE RETIRO', LM, doc.y);
        doc.moveDown(0.3);
        const firmaY = doc.y;
        roundRect(doc, LM, firmaY, 200, 70, 6, LIGHT, LINE);
        try {
          const firmaBuffer = Buffer.from(factura.firma_base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
          doc.image(firmaBuffer, LM + 5, firmaY + 5, { width: 190, height: 60, fit: [190, 60] });
        } catch (e) {
          doc.font('Helvetica').fontSize(8).fillColor(GRAY)
             .text('Firma registrada', LM + 10, firmaY + 25);
        }
        doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
           .text(`Retiro: ${fmtFecha(factura.fecha_entrega)}`, LM, firmaY + 76);
      }

      // ══════════════════════════════════════════════════════════════════
      // PIE DE PÁGINA
      // ══════════════════════════════════════════════════════════════════
      const footerY = doc.page.height - 70;
      doc.rect(0, footerY, doc.page.width, 70).fill(NAVY);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE)
         .text('NEA CARGO XPRESS', LM, footerY + 14);
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
         .text('Miami → Panamá · Casillero Virtual', LM, footerY + 26)
         .text('+507 6293-7497', LM, footerY + 38)
         .text('info@neacargoxpress.com', LM, footerY + 50);

      doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8')
         .text(
           'Este documento es un comprobante interno de NEA Cargo Xpress.\nNo es una factura fiscal electrónica ante la DGI.',
           0, footerY + 16,
           { width: doc.page.width - 50, align: 'right' }
         );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generarPdfFactura };
