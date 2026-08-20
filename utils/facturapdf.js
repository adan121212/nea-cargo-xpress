const PDFDocument = require('pdfkit');

const NAVY   = '#0c1b33';
const ORANGE = '#ff6a1a';
const GRAY   = '#6b7280';
const LIGHT  = '#f5f6f8';
const LINE   = '#e5e7eb';
const WHITE  = '#ffffff';

// ── ITBMS ────────────────────────────────────────────────────────────────
// Pendiente de confirmar con el contador si el courier lleva ITBMS y a qué %.
// Mientras tanto queda en 0 (no cobra impuesto y el total no cambia).
// Cuando el contador confirme, poner p.ej. 0.07 para 7%.
const TASA_ITBMS = 0;

const fmt$ = n => `$${Number(n || 0).toFixed(2)}`;
const fmtFecha = d => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-PA', { day:'2-digit', month:'long', year:'numeric' });
};
const estadoLabel = e => ({ pendiente:'Pendiente de pago', pagada:'Pagada', anulada:'Anulada' }[e] || e);
// Devuelve el valor o un guion si viene vacío/null/undefined
const val = v => (v === null || v === undefined || v === '') ? '—' : String(v);
// Formatea una medida en pulgadas (o guion si no viene)
const med = v => (v === null || v === undefined || v === '') ? '—' : Number(v).toFixed(1);

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
      doc.roundedRect(LM, 14, 48, 48, 8).fill(ORANGE);
      doc.font('Helvetica-Bold').fontSize(22).fillColor(NAVY)
         .text('N', LM, 27, { width:48, align:'center' });
      doc.font('Helvetica-Bold').fontSize(15).fillColor(WHITE)
         .text('NEA CARGO XPRESS', LM + 58, 18);
      doc.font('Helvetica').fontSize(8.5).fillColor('#94a3b8')
         .text('Miami → Panamá · Casillero Virtual', LM + 58, 36);

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
      const bloqueH = 104;

      // Columna izquierda: cliente
      doc.rect(LM, bloqueY, colW, bloqueH).fill(LIGHT);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(ORANGE)
         .text('CLIENTE', LM + 8, bloqueY + 8);
      const nombreCliente = `${factura.cliente_nombre || ''} ${factura.cliente_apellido || ''}`.trim() || '—';
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY)
         .text(nombreCliente, LM + 8, bloqueY + 19, { width: colW - 16 });
      doc.font('Helvetica').fontSize(8).fillColor(GRAY)
         .text(`Casillero: Cliente ${factura.numero_casillero || '—'}`, LM + 8, bloqueY + 34, { width: colW - 16 });
      // RUC solo si viene (cuentas empresa)
      let oy = 46;
      if (factura.cliente_ruc) {
        doc.text(`RUC: ${factura.cliente_ruc}`, LM + 8, bloqueY + oy, { width: colW - 16 });
        oy += 12;
      }
      doc.text(`Tel: ${val(factura.cliente_telefono)}`, LM + 8, bloqueY + oy, { width: colW - 16 });
      oy += 12;
      doc.text(val(factura.cliente_email), LM + 8, bloqueY + oy, { width: colW - 16 });

      // Columna derecha: fechas
      doc.rect(col2X, bloqueY, colW, bloqueH).fill(LIGHT);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(ORANGE)
         .text('INFORMACIÓN', col2X + 8, bloqueY + 8);
      const fi = (label, valor, offy) => {
        doc.font('Helvetica-Bold').fontSize(7).fillColor(GRAY)
           .text(label, col2X + 8, bloqueY + 19 + offy);
        doc.font('Helvetica').fontSize(8).fillColor(NAVY)
           .text(valor, col2X + 8, bloqueY + 27 + offy, { width: colW - 16 });
      };
      fi('Emisión',  fmtFecha(factura.fecha_creacion), 0);
      fi('Pago',     fmtFecha(factura.fecha_pago), 20);
      fi('Entrega',  fmtFecha(factura.fecha_entrega), 40);
      doc.y = bloqueY + bloqueH + 12;

      // ── DETALLE DEL ENVÍO (con columnas de medidas separadas) ─────────────
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORANGE)
         .text('DETALLE DEL ENVÍO', LM, doc.y);
      doc.y += 8;
      const tblY = doc.y;

      // Posiciones de columna (proporción del ancho W)
      const cX = {
        tienda:  LM + 6,
        peso:    LM + W * 0.40,
        largo:   LM + W * 0.52,
        alto:    LM + W * 0.62,
        ancho:   LM + W * 0.72,
        volumen: LM + W * 0.82,
      };
      doc.rect(LM, tblY, W, 18).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(WHITE)
         .text('TIENDA / TRACKING', cX.tienda, tblY + 6)
         .text('PESO', cX.peso, tblY + 6)
         .text('LARGO', cX.largo, tblY + 6)
         .text('ALTO', cX.alto, tblY + 6)
         .text('ANCHO', cX.ancho, tblY + 6)
         .text('PESO VOL.', cX.volumen, tblY + 6);

      const rowY = tblY + 18;
      doc.rect(LM, rowY, W, 24).fill(WHITE).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
         .text(factura.tienda || '—', cX.tienda, rowY + 4, { width: W * 0.36 });
      doc.font('Helvetica').fontSize(6.5).fillColor(GRAY)
         .text(`#${factura.numero_tracking || '—'}`, cX.tienda, rowY + 15, { width: W * 0.36 });
      // Peso volumétrico en libras: usa el guardado (peso_volumetrico_lb); si no viene,
      // lo calcula con la fórmula aérea estándar (L × Alto × Ancho ÷ 166). Guion si faltan medidas.
      const L = Number(factura.largo_in), A = Number(factura.alto_in), An = Number(factura.ancho_in);
      let pesoVol = Number(factura.peso_volumetrico_lb);
      if (!(pesoVol > 0) && L > 0 && A > 0 && An > 0) {
        pesoVol = Math.ceil(((L * A * An) / 166) * 2) / 2;
      }
      const volumen = pesoVol > 0 ? pesoVol.toFixed(2) + ' lb' : '—';
      doc.font('Helvetica').fontSize(8).fillColor(NAVY)
         .text(`${Number(factura.peso_facturado_lb || 0).toFixed(2)} lb`, cX.peso, rowY + 8)
         .text(med(factura.largo_in), cX.largo, rowY + 8)
         .text(med(factura.alto_in), cX.alto, rowY + 8)
         .text(med(factura.ancho_in), cX.ancho, rowY + 8)
         .text(volumen, cX.volumen, rowY + 8);
      doc.y = rowY + 32;

      // ── DESGLOSE DE COBROS ────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORANGE)
         .text('DESGLOSE DE COBROS', LM, doc.y);
      doc.y += 8;
      const dX = LM + W * 0.32;
      const dW = W * 0.68;

      const conceptos = [
        [`Flete (${Number(factura.peso_facturado_lb||0).toFixed(2)} lb × $${Number(factura.precio_libra||0).toFixed(2)}/lb)`, Number(factura.costo_envio||0)],
        ['Cargo de manejo', Number(factura.cargo_manejo||0)],
        ['Seguro', Number(factura.seguro||0)],
      ];
      conceptos.forEach(([label, valor], i) => {
        const cy = doc.y;
        if (i % 2 === 0) doc.rect(dX, cy, dW, 18).fill('#f9fafb');
        doc.font('Helvetica').fontSize(8.5).fillColor(GRAY)
           .text(label, dX + 6, cy + 4, { width: dW * 0.65 });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
           .text(fmt$(valor), dX, cy + 4, { width: dW - 6, align:'right' });
        doc.y = cy + 18;
      });

      // Subtotal / ITBMS / Total
      const subtotal = Number(factura.total || 0) > 0 && TASA_ITBMS === 0
        ? Number(factura.total || 0)
        : conceptos.reduce((s, [,v]) => s + v, 0);
      const itbms = +(subtotal * TASA_ITBMS).toFixed(2);
      const totalConImpuesto = +(subtotal + itbms).toFixed(2);

      doc.moveTo(dX, doc.y + 3).lineTo(RM, doc.y + 3)
         .strokeColor(LINE).lineWidth(0.5).stroke();
      doc.y += 7;

      const filaResumen = (label, valor, bold) => {
        const fy = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(bold ? NAVY : GRAY)
           .text(label, dX + 6, fy + 2, { width: dW * 0.6 });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
           .text(fmt$(valor), dX, fy + 2, { width: dW - 6, align:'right' });
        doc.y = fy + 15;
      };
      filaResumen('Subtotal', subtotal, false);
      // Fila de ITBMS: solo se muestra si la tasa es mayor a 0
      if (TASA_ITBMS > 0) {
        filaResumen(`ITBMS (${(TASA_ITBMS*100).toFixed(0)}%)`, itbms, false);
      }

      doc.moveTo(dX, doc.y + 2).lineTo(RM, doc.y + 2)
         .strokeColor(ORANGE).lineWidth(1.5).stroke();
      doc.y += 6;

      const totalY = doc.y;
      doc.rect(dX, totalY, dW, 28).fill(NAVY);
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
         .text('TOTAL A PAGAR', dX + 8, totalY + 5);
      doc.font('Helvetica-Bold').fontSize(14).fillColor(ORANGE)
         .text(fmt$(totalConImpuesto), dX, totalY + 5, { width: dW - 8, align:'right' });
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
           .text(`Casillero: Cliente ${factura.numero_casillero || '—'} · Tel: ${val(factura.cliente_telefono)}`, LM, firmaY + 77);
        doc.y = firmaY + 92;
      }

      // ── CONDICIONES / MERCANCÍA PROHIBIDA ─────────────────────────────────
      doc.y += 10;
      doc.moveTo(LM, doc.y).lineTo(RM, doc.y).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.y += 6;
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(GRAY)
         .text('CONDICIONES', LM, doc.y);
      doc.y += 8;
      doc.font('Helvetica').fontSize(6.5).fillColor(GRAY).text(
        'Pasados 30 días desde la recepción del paquete no se aceptan reclamos. NEA Cargo Xpress no transporta mercancía ' +
        'prohibida (explosivos, armas, químicos peligrosos, sustancias controladas, dinero en efectivo). La empresa no se ' +
        'responsabiliza por cargos aduaneros, impuestos de importación, ni por demoras causadas por terceros transportistas. ' +
        'El cliente declara que el contenido y valor de su paquete son correctos.',
        LM, doc.y, { width: W, align:'justify', lineGap: 1 }
      );

      // ── PIE DE PÁGINA ─────────────────────────────────────────────────────
      doc.y += 10;
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
