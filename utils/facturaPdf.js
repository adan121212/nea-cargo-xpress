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
      const doc = new PDFDocument({ size:'LETTER', margin:50, autoFirstPage:true });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const LM = 50;
      const RM = doc.page.width - 50;
      const W  = RM - LM;

      // ── CABECERA ─────────────────────────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 80).fill(NAVY);

      // Logo naranja
      doc.roundedRect(LM, 14, 48, 48, 8).fill(ORANGE);
      doc.font('Helvetica-Bold').fontSize(22).fillColor(NAVY)
         .text('N', LM, 27, { width:48, align:'center' });

      // Nombre empresa
      doc.font('Helvetica-Bold').fontSize(15).fillColor(WHITE)
         .text('NEA CARGO XPRESS', LM + 58, 18);
      doc.font('Helvetica').fontSize(8.5).fillColor('#94a3b8')
         .text('Miami → Panamá · Casillero Virtual', LM + 58, 36);

      // Número factura y badge estado
      const estado = factura.estado || 'pendiente';
      const colorBadge = estado === 'pagada' ? '#22c55e' : estado === 'anulada' ? '#6b7280' : ORANGE;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#94a3b8')
         .text('FACTURA', 0, 16, { width: RM, align:'right' });
      doc.font('Helvetica-Bold').fontSize(16).fillColor(ORANGE)
         .text(factura.numero_factura || '—', 0, 30, { width: RM, align:'right' });
      const badgeW = 100, badgeX = RM - badgeW, badgeY = 52;
      doc.roundedRect(badgeX, badgeY, badgeW, 16, 4).fill(colorBadge);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(WHITE)
         .text(estadoLabel(estado).toUpperCase(), badgeX, badgeY + 4, { width:badgeW, align:'center' });

      doc.y = 92;

      // ── DATOS CLIENTE + FACTURA ───────────────────────────────────────────
      const colW = (W - 12) / 2;
      const col2X = LM + colW + 12;
      const bloqueY = doc.y;
      const bloqueH = 90;

      doc.rect(LM, bloqueY, colW, bloqueH).fill(LIGHT);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(ORANGE)
         .text('CLIENTE', LM + 8, bloqueY + 8);
      const nombreCliente = `${factura.cliente_nombre || ''} ${factura.cliente_apellido || ''}`.trim();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY)
         .text(nombreCliente, LM + 8, bloqueY + 19, { width: colW - 16 });
      doc.font('Helvetica').fontSize(8).fillColor(GRAY)
         .text(factura.cliente_email || '—', LM + 8, bloqueY + 34, { width: colW - 16 })
         .text(`Casillero: ${factura.numero_casillero || '—'}`, LM + 8, bloqueY + 46)
         .text(`Tel: ${factura.cliente_telefono || 'No registrado'}`, LM + 8, bloqueY + 58);

      doc.rect(col2X, bloqueY, colW, bloqueH).fill(LIGHT);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(ORANGE)
         .text('INFORMACIÓN', col2X + 8, bloqueY + 8);

      const fi = (label, valor, oy) => {
        doc.font('Helvetica-Bold').fontSize(7).fillColor(GRAY)
           .text(label, col2X + 8, bloqueY + 19 + oy);
        doc.font('Helvetica').fontSize(8).fillColor(NAVY)
           .text(valor, col2X + 8, bloqueY + 27 + oy, { width: colW - 16 });
      };
      fi('Emisión',  fmtFecha(factura.fecha_creacion), 0);
      fi('Pago',     fmtFecha(factura.fecha_pago), 20);
      fi('Entrega',  fmtFecha(factura.fecha_entrega), 40);

      doc.y = bloqueY + bloqueH + 12;

      // ── DETALLE PAQUETE ───────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORANGE)
         .text('DETALLE DEL ENVÍO', LM, doc.y);
      doc.y += 8;

      const tblY = doc.y;
      doc.rect(LM, tblY, W, 18).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(WHITE)
         .text('TIENDA', LM + 6, tblY + 5)
         .text('TRACKING', LM + W * 0.35, tblY + 5)
         .text('PESO', LM + W * 0.65, tblY + 5)
         .text('VALOR', LM + W * 0.80, tblY + 5);

      const rowY = tblY + 18;
      doc.rect(LM, rowY, W, 20).fill(WHITE).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
         .text(factura.tienda || '—', LM + 6, rowY + 6, { width: W * 0.32 });
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
         .text(factura.numero_tracking || '—', LM + W * 0.35, rowY + 6, { width: W * 0.28 })
         .text(`${Number(factura.peso_facturado_lb || 0).toFixed(2)} lb`, LM + W * 0.65, rowY + 6)
         .text(fmt$(factura.valor_declarado), LM + W * 0.80, rowY + 6);

      doc.y = rowY + 28;

      // ── DESGLOSE ──────────────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORANGE)
         .text('DESGLOSE DE COBROS', LM, doc.y);
      doc.y += 8;

      const dX = LM + W * 0.32;
      const dW = W * 0.68;
      const conceptos = [
        [`Flete (${Number(factura.peso_facturado_lb||0).toFixed(2)} lb × $${Number(factura.precio_libra||0).toFixed(2)}/lb)`, fmt$(factura.costo_envio)],
        ['Cargo de manejo', fmt$(factura.cargo_manejo)],
        ['Seguro', fmt$(factura.seguro)],
      ];
      conceptos.forEach(([label, valor], i) => {
        const cy = doc.y;
        if (i % 2 === 0) doc.rect(dX, cy, dW, 18).fill('#f9fafb');
        doc.font('Helvetica').fontSize(8.5).fillColor(GRAY)
           .text(label, dX + 6, cy + 4, { width: dW * 0.65 });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
           .text(valor, dX, cy + 4, { width: dW - 6, align:'right' });
        doc.y = cy + 18;
      });

      doc.moveTo(dX, doc.y + 3).lineTo(RM, doc.y + 3)
         .strokeColor(ORANGE).lineWidth(1.5).stroke();
      doc.y += 7;

      const totalY = doc.y;
      doc.rect(dX, totalY, dW, 28).fill(NAVY);
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
         .text('TOTAL A PAGAR', dX + 8, totalY + 5);
      doc.font('Helvetica-Bold').fontSize(14).fillColor(ORANGE)
         .text(fmt$(factura.total), dX, totalY + 5, { width: dW - 8, align:'right' });
      doc.y = totalY + 36;

      // ── FIRMA ─────────────────────────────────────────────────────────────
      if (factura.firma_base64) {
        doc.y += 8;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORANGE)
           .text('FIRMA DE RETIRO', LM, doc.y);
        doc.y += 6;
        const firmaY = doc.y;
        doc.rect(LM, firmaY, 180, 60).fill(LIGHT).strokeColor(LINE).lineWidth(0.5).stroke();
        try {
          const buf = Buffer.from(
            factura.firma_base64.replace(/^data:image\/\w+;base64,/, ''), 'base64'
          );
          doc.image(buf, LM + 3, firmaY + 3, { width:174, height:54, fit:[174,54] });
        } catch(e) {}
        doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
           .text(`Entrega: ${fmtFecha(factura.fecha_entrega)}`, LM, firmaY + 66)
           .text(`Casillero: ${factura.numero_casillero || '—'} · Tel: ${factura.cliente_telefono || '—'}`, LM, firmaY + 77);
        doc.y = firmaY + 92;
      }

      // ── PIE DE PÁGINA (flujo normal, sin coordenada absoluta) ────────────
      doc.y += 12;
      doc.moveTo(LM, doc.y).lineTo(RM, doc.y).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.y += 6;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
         .text('NEA CARGO XPRESS', LM, doc.y);
      doc.font('Helvetica').fontSize(7).fillColor(GRAY)
         .text('Miami → Panamá · +507 6293-7497 · info@neacargoxpress.com', LM, doc.y + 10)
         .text('Comprobante interno — no es una factura fiscal electrónica DGI.', LM, doc.y + 20);

      doc.end();
    } catch(err) {
      reject(err);
    }
  });
}

module.exports = { generarPdfFactura };
