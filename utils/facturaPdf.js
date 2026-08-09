const PDFDocument = require('pdfkit');

const NAVY   = '#0c1b33';
const ORANGE = '#ff6a1a';
const GRAY   = '#6b7280';
const LIGHT  = '#f5f6f8';
const LINE   = '#e5e7eb';
const WHITE  = '#ffffff';

const fmt$ = n => `$${Number(n || 0).toFixed(2)}`;
const fmtFecha = d => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-PA', { day:'2-digit', month:'long', year:'numeric' });
};
const estadoLabel = e => ({ pendiente:'Pendiente de pago', pagada:'Pagada', anulada:'Anulada' }[e] || e);

async function generarPdfFactura(factura) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size:'LETTER', margin:50 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const LM = 50;
      const RM = doc.page.width - 50;
      const W  = RM - LM;

      // ── CABECERA ─────────────────────────────────────────────────────────
      // Fondo navy solo en el área de la cabecera (altura fija 90)
      doc.rect(0, 0, doc.page.width, 90).fill(NAVY);

      // Logo naranja
      doc.roundedRect(LM, 15, 52, 52, 8).fill(ORANGE);
      doc.font('Helvetica-Bold').fontSize(24).fillColor(NAVY)
         .text('N', LM, 28, { width:52, align:'center' });

      // Nombre empresa
      doc.font('Helvetica-Bold').fontSize(16).fillColor(WHITE)
         .text('NEA CARGO XPRESS', LM + 62, 20);
      doc.font('Helvetica').fontSize(9).fillColor('#94a3b8')
         .text('Miami → Panamá · Casillero Virtual', LM + 62, 40);

      // Número factura y badge estado a la derecha
      const estado = factura.estado || 'pendiente';
      const colorBadge = estado === 'pagada' ? '#22c55e' : estado === 'anulada' ? '#6b7280' : ORANGE;
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#94a3b8')
         .text('FACTURA', 0, 18, { width: RM, align:'right' });
      doc.font('Helvetica-Bold').fontSize(18).fillColor(ORANGE)
         .text(factura.numero_factura || '—', 0, 32, { width: RM, align:'right' });

      // Badge estado
      const badgeW = 110, badgeX = RM - badgeW, badgeY = 60;
      doc.roundedRect(badgeX, badgeY, badgeW, 18, 4).fill(colorBadge);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE)
         .text(estadoLabel(estado).toUpperCase(), badgeX, badgeY + 5, { width:badgeW, align:'center' });

      // ── DESPUÉS DE CABECERA ───────────────────────────────────────────────
      doc.y = 106;

      // ── DATOS: CLIENTE + FACTURA lado a lado ─────────────────────────────
      const colW = (W - 16) / 2;
      const col2X = LM + colW + 16;
      const bloqueY = doc.y;

      // Bloque cliente
      doc.rect(LM, bloqueY, colW, 100).fill(LIGHT);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORANGE)
         .text('CLIENTE', LM + 10, bloqueY + 10);
      const nombreCliente = `${factura.cliente_nombre || ''} ${factura.cliente_apellido || ''}`.trim();
      doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY)
         .text(nombreCliente, LM + 10, bloqueY + 22, { width: colW - 20 });
      doc.font('Helvetica').fontSize(8.5).fillColor(GRAY)
         .text(factura.cliente_email || '—', LM + 10, bloqueY + 38, { width: colW - 20 })
         .text(`Casillero: ${factura.numero_casillero || '—'}`, LM + 10, bloqueY + 52)
         .text(`Tel: ${factura.cliente_telefono || 'No registrado'}`, LM + 10, bloqueY + 66);

      // Bloque factura
      doc.rect(col2X, bloqueY, colW, 100).fill(LIGHT);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORANGE)
         .text('INFORMACIÓN', col2X + 10, bloqueY + 10);

      const filaInfo = (label, valor, offsetY) => {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GRAY)
           .text(label, col2X + 10, bloqueY + 22 + offsetY);
        doc.font('Helvetica').fontSize(8.5).fillColor(NAVY)
           .text(valor, col2X + 10, bloqueY + 32 + offsetY, { width: colW - 20 });
      };
      filaInfo('Emisión',    fmtFecha(factura.fecha_creacion), 0);
      filaInfo('Pago',       fmtFecha(factura.fecha_pago), 22);
      filaInfo('Entrega',    fmtFecha(factura.fecha_entrega), 44);

      doc.y = bloqueY + 110;

      // ── DETALLE PAQUETE ───────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE)
         .text('DETALLE DEL ENVÍO', LM, doc.y);
      doc.moveDown(0.3);

      const tblY = doc.y;
      // Encabezado tabla
      doc.rect(LM, tblY, W, 20).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(WHITE)
         .text('TIENDA / DESCRIPCIÓN', LM + 8, tblY + 6)
         .text('TRACKING', LM + W * 0.40, tblY + 6)
         .text('PESO', LM + W * 0.68, tblY + 6)
         .text('VALOR', LM + W * 0.82, tblY + 6);

      // Fila datos
      const rowY = tblY + 20;
      doc.rect(LM, rowY, W, 24).fill(WHITE).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
         .text(factura.tienda || '—', LM + 8, rowY + 7, { width: W * 0.37 });
      doc.font('Helvetica').fontSize(8).fillColor(GRAY)
         .text(factura.numero_tracking || '—', LM + W * 0.40, rowY + 7, { width: W * 0.26 })
         .text(`${Number(factura.peso_facturado_lb || 0).toFixed(2)} lb`, LM + W * 0.68, rowY + 7)
         .text(fmt$(factura.valor_declarado), LM + W * 0.82, rowY + 7);

      doc.y = rowY + 34;

      // ── DESGLOSE DE COBROS ────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE)
         .text('DESGLOSE DE COBROS', LM, doc.y);
      doc.moveDown(0.3);

      const desgloseX = LM + W * 0.35;
      const desgloseW = W * 0.65;
      const conceptos = [
        [`Flete (${Number(factura.peso_facturado_lb||0).toFixed(2)} lb × $${Number(factura.precio_libra||0).toFixed(2)}/lb)`, fmt$(factura.costo_envio)],
        ['Cargo de manejo', fmt$(factura.cargo_manejo)],
        ['Seguro (sobre valor declarado)', fmt$(factura.seguro)],
      ];

      conceptos.forEach(([label, valor], i) => {
        const cy = doc.y;
        if (i % 2 === 0) doc.rect(desgloseX, cy, desgloseW, 20).fill('#f9fafb');
        doc.font('Helvetica').fontSize(9).fillColor(GRAY)
           .text(label, desgloseX + 8, cy + 5, { width: desgloseW * 0.7 });
        doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
           .text(valor, desgloseX, cy + 5, { width: desgloseW - 8, align:'right' });
        doc.y = cy + 20;
      });

      // Línea divisoria naranja
      doc.moveTo(desgloseX, doc.y + 4).lineTo(RM, doc.y + 4)
         .strokeColor(ORANGE).lineWidth(1.5).stroke();
      doc.y += 8;

      // Caja TOTAL
      const totalY = doc.y;
      doc.rect(desgloseX, totalY, desgloseW, 32).fill(NAVY);
      doc.font('Helvetica').fontSize(8.5).fillColor('#94a3b8')
         .text('TOTAL A PAGAR', desgloseX + 10, totalY + 7);
      doc.font('Helvetica-Bold').fontSize(16).fillColor(ORANGE)
         .text(fmt$(factura.total), desgloseX, totalY + 6, { width: desgloseW - 10, align:'right' });

      doc.y = totalY + 42;

      // ── FIRMA DIGITAL ─────────────────────────────────────────────────────
      if (factura.firma_base64) {
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(ORANGE)
           .text('FIRMA DE RETIRO', LM, doc.y);
        doc.moveDown(0.3);
        const firmaY = doc.y;
        doc.rect(LM, firmaY, 200, 70).fill(LIGHT).strokeColor(LINE).lineWidth(0.5).stroke();
        try {
          const buf = Buffer.from(
            factura.firma_base64.replace(/^data:image\/\w+;base64,/, ''), 'base64'
          );
          doc.image(buf, LM + 4, firmaY + 4, { width:192, height:62, fit:[192,62] });
        } catch(e) {}
        doc.font('Helvetica').fontSize(8).fillColor(GRAY)
           .text(`Entrega: ${fmtFecha(factura.fecha_entrega)}`, LM, firmaY + 76)
           .text(`Casillero: ${factura.numero_casillero || '—'}`, LM, firmaY + 89)
           .text(`Teléfono: ${factura.cliente_telefono || '—'}`, LM, firmaY + 102)
           .text('Retiro autorizado: Firma digital adjunta', LM, firmaY + 115);
        doc.y = firmaY + 130;
      }

      // ── PIE DE PÁGINA (pegado al fondo de la página) ──────────────────────
      const pageH = doc.page.height;
      doc.rect(0, pageH - 60, doc.page.width, 60).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE)
         .text('NEA CARGO XPRESS', LM, pageH - 48);
      doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8')
         .text('Miami → Panamá · +507 6293-7497 · info@neacargoxpress.com', LM, pageH - 35)
         .text('Comprobante interno — no es una factura fiscal electrónica DGI.',
               0, pageH - 22, { width: RM, align:'right' });

      doc.end();
    } catch(err) {
      reject(err);
    }
  });
}

module.exports = { generarPdfFactura };
