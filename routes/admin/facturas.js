const express = require('express');
const crypto = require('crypto');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { generarNumeroFactura } = require('../../utils/factura');
const { generarPdfFactura } = require('../../utils/facturaPdf');
const { enviarFacturaPorCorreo } = require('../../utils/mailer');
const { enviarFacturaPorWhatsapp } = require('../../utils/whatsapp');

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// Código para autorizar anulaciones. Se puede cambiar en Render
// con la variable de entorno CODIGO_ANULACION sin tocar el código.
const CODIGO_ANULACION = process.env.CODIGO_ANULACION || '1234';

// Motivos válidos de anulación
const MOTIVOS_ANULACION = [
  'error_facturacion',
  'devolucion',
  'paquete_perdido',
  'paquete_danado',
  'cliente_desistio',
  'otro',
];

// Cada tarifa cobra por SU propio peso: si su nombre contiene "volumen", se cobra el peso
// volumétrico (calculado del tamaño de la caja); cualquier otra tarifa cobra el peso real
// (balanza). La tarifa elegida es la que decide qué peso se factura — no hay comparación
// automática entre los dos. Si la tarifa es de volumen pero el paquete no tiene medidas,
// se usa el peso real para no facturar en $0.
function calcularPesoFacturado(paquete, tarifa) {
  const pesoReal = Number(paquete.peso_real_lb ?? paquete.peso_lb ?? 0);
  const pesoVol = Number(paquete.peso_volumetrico_lb ?? 0);
  const esTarifaVolumetrica = /volum/i.test((tarifa && tarifa.nombre) || '');
  const peso = (esTarifaVolumetrica && pesoVol > 0) ? pesoVol : pesoReal;
  return peso || null;
}

// SELECT reutilizable para armar el objeto factura que va al PDF.
// Incluye teléfono, RUC y medidas + peso volumétrico para el diseño nuevo.
const SELECT_FACTURA_PDF = `
  SELECT f.*,
         u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
         u.email AS cliente_email, u.telefono AS cliente_telefono,
         u.ruc AS cliente_ruc, u.numero_casillero,
         p.tienda, p.numero_tracking, p.firma_base64, p.fecha_entrega,
         p.largo_in, p.ancho_in, p.alto_in, p.peso_volumetrico_lb, p.peso_real_lb
  FROM facturas f
  JOIN usuarios u ON u.id = f.usuario_id
  JOIN paquetes p ON p.id = f.paquete_id
  WHERE f.id = $1`;

// --- POST /api/admin/facturas ---
router.post(
  '/',
  [
    body('paquete_id').isInt().withMessage('paquete_id es obligatorio'),
    body('tarifa_id').isInt().withMessage('tarifa_id es obligatorio'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }
    const { paquete_id, tarifa_id } = req.body;
    const hoy = new Date().toISOString().slice(0, 10);
    const cajaHoy = await pool.query('SELECT id FROM cierres_caja WHERE fecha = $1', [hoy]);
    if (cajaHoy.rows.length > 0) {
      return res.status(409).json({
        mensaje: `La caja del ${hoy} ya fue cerrada. No se pueden generar nuevas facturas para hoy.`,
        caja_cerrada: true,
      });
    }
    const client = await pool.connect();
    try {
      const paqueteRes = await client.query('SELECT * FROM paquetes WHERE id = $1', [paquete_id]);
      if (paqueteRes.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      const paquete = paqueteRes.rows[0];
      const tarifaRes = await client.query('SELECT * FROM tarifas WHERE id = $1', [tarifa_id]);
      if (tarifaRes.rows.length === 0) return res.status(404).json({ mensaje: 'Tarifa no encontrada' });
      const tarifa = tarifaRes.rows[0];
      const pesoFacturado = calcularPesoFacturado(paquete, tarifa);
      if (!pesoFacturado) return res.status(400).json({ mensaje: 'Este paquete no tiene un peso registrado.' });
      const yaFacturado = await client.query(`SELECT id FROM facturas WHERE paquete_id = $1 AND estado <> 'anulada'`, [paquete_id]);
      if (yaFacturado.rows.length > 0) return res.status(409).json({ mensaje: 'Este paquete ya tiene una factura activa.' });
      const costoEnvio = Math.max(Number(pesoFacturado) * Number(tarifa.precio_libra), Number(tarifa.cargo_minimo));
      const seguro = paquete.valor_declarado ? (Number(paquete.valor_declarado) * Number(tarifa.pct_seguro)) / 100 : 0;
      const cargoManejo = Number(tarifa.cargo_manejo);
      const total = costoEnvio + cargoManejo + seguro;
      await client.query('BEGIN');
      const insercion = await client.query(
        `INSERT INTO facturas (paquete_id, usuario_id, tarifa_id, peso_facturado_lb, precio_libra, costo_envio, cargo_manejo, seguro, total, token_pdf)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [paquete_id, paquete.usuario_id, tarifa_id, pesoFacturado, tarifa.precio_libra, costoEnvio.toFixed(2), cargoManejo.toFixed(2), seguro.toFixed(2), total.toFixed(2), crypto.randomBytes(24).toString('hex')]
      );
      const factura = insercion.rows[0];
      const numeroFactura = generarNumeroFactura(factura.id);
      await client.query('UPDATE facturas SET numero_factura = $1 WHERE id = $2', [numeroFactura, factura.id]);
      await client.query(`UPDATE paquetes SET estado = 'listo_para_retiro', fecha_actualizacion = NOW() WHERE id = $1 AND estado NOT IN ('entregado','listo_para_retiro')`, [paquete_id]);
      await client.query('COMMIT');
      const facturaCompleta = { ...factura, numero_factura: numeroFactura };
      const datosCompletos = await pool.query(SELECT_FACTURA_PDF, [factura.id]);
      const facturaParaEnvio = datosCompletos.rows[0];
      const envios = { correo_enviado: false, whatsapp_enviado: false, errores_envio: [] };
      try {
        const pdfBuffer = await generarPdfFactura(facturaParaEnvio);
        await enviarFacturaPorCorreo(facturaParaEnvio.cliente_email, facturaParaEnvio.cliente_nombre, facturaParaEnvio, pdfBuffer);
        envios.correo_enviado = true;
      } catch (errorCorreo) {
        console.error('Error enviando factura por correo:', errorCorreo);
        envios.errores_envio.push(`Correo: ${errorCorreo.message}`);
      }
      if (facturaParaEnvio.cliente_telefono) {
        try {
          const urlPdfPublica = `${process.env.BASE_URL}/api/public/facturas/${facturaParaEnvio.token_pdf}/pdf`;
          await enviarFacturaPorWhatsapp(facturaParaEnvio.cliente_telefono, facturaParaEnvio, urlPdfPublica);
          envios.whatsapp_enviado = true;
        } catch (errorWhatsapp) {
          console.error('Error enviando factura por WhatsApp:', errorWhatsapp);
          envios.errores_envio.push(`WhatsApp: ${errorWhatsapp.message}`);
        }
      }
      return res.status(201).json({ mensaje: 'Factura generada', factura: facturaCompleta, envios });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en POST /admin/facturas:', error);
      return res.status(500).json({ mensaje: 'Error interno al generar la factura' });
    } finally {
      client.release();
    }
  }
);

// --- GET /api/admin/facturas ---
// Devuelve también los datos de anulación (motivo, quién y cuándo)
router.get('/', [
  query('estado').optional().isIn(['pendiente','pagada','anulada']),
  query('email').optional().trim(),
  query('motivo').optional().trim(),
], async (req, res) => {
  const { estado, email, motivo } = req.query;
  const condiciones = [], valores = [];
  if (estado) { valores.push(estado); condiciones.push(`f.estado = $${valores.length}`); }
  if (email) { valores.push(`%${email}%`); condiciones.push(`u.email ILIKE $${valores.length}`); }
  if (motivo) { valores.push(motivo); condiciones.push(`f.motivo_anulacion = $${valores.length}`); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  try {
    const resultado = await pool.query(
      `SELECT f.*,
              u.nombre AS cliente_nombre, u.apellido AS cliente_apellido, u.email AS cliente_email,
              p.id AS paquete_id, p.tienda, p.numero_tracking, p.estado AS paquete_estado,
              a.nombre AS anulada_por_nombre, a.apellido AS anulada_por_apellido
       FROM facturas f
       JOIN usuarios u ON u.id = f.usuario_id
       JOIN paquetes p ON p.id = f.paquete_id
       LEFT JOIN usuarios a ON a.id = f.anulada_por
       ${where}
       ORDER BY f.fecha_creacion DESC LIMIT 200`,
      valores
    );
    return res.json({ facturas: resultado.rows });
  } catch (error) {
    console.error('Error en GET /admin/facturas:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar facturas' });
  }
});

// --- PATCH /api/admin/facturas/:id/estado ---
// Al anular exige codigo_anulacion + motivo obligatorio.
// Guarda motivo, quién anuló y cuándo. Conserva la fecha_pago original.
// Si estaba pagada y la caja ya cerró, agrega nota de ajuste al cierre.
// Libera el paquete para poder refacturarlo.
router.patch('/:id/estado', [
  body('estado').isIn(['pendiente','pagada','anulada']).withMessage('Estado inválido'),
  body('motivo').optional().isIn(MOTIVOS_ANULACION).withMessage('Motivo de anulación inválido'),
  body('motivo_detalle').optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
], async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
  const esAnulacion = req.body.estado === 'anulada';
  if (esAnulacion) {
    if (req.body.codigo_anulacion !== CODIGO_ANULACION) {
      return res.status(403).json({ mensaje: 'Código de anulación incorrecto.' });
    }
    if (!req.body.motivo) {
      return res.status(400).json({ mensaje: 'Debes indicar el motivo de la anulación.' });
    }
    if (req.body.motivo === 'otro' && !(req.body.motivo_detalle || '').trim()) {
      return res.status(400).json({ mensaje: 'Cuando el motivo es "Otro" debes escribir una explicación.' });
    }
  }
  try {
    const facturaActual = await pool.query('SELECT * FROM facturas WHERE id = $1', [req.params.id]);
    if (facturaActual.rows.length === 0) return res.status(404).json({ mensaje: 'Factura no encontrada' });
    const facturaAntes = facturaActual.rows[0];
    if (facturaAntes.estado === 'anulada' && esAnulacion) {
      return res.status(409).json({ mensaje: 'Esta factura ya está anulada.' });
    }
    let resultado;
    if (esAnulacion) {
      // Conserva la fecha_pago original — no la borra
      resultado = await pool.query(
        `UPDATE facturas
         SET estado = 'anulada',
             motivo_anulacion = $1,
             motivo_anulacion_detalle = $2,
             anulada_por = $3,
             fecha_anulacion = NOW()
         WHERE id = $4 RETURNING *`,
        [req.body.motivo, (req.body.motivo_detalle || '').trim() || null, req.usuario.id, req.params.id]
      );
    } else {
      const fechaPago = req.body.estado === 'pagada' ? 'NOW()' : 'NULL';
      resultado = await pool.query(
        `UPDATE facturas SET estado = $1, fecha_pago = ${fechaPago} WHERE id = $2 RETURNING *`,
        [req.body.estado, req.params.id]
      );
    }
    let nota_ajuste = null;
    if (esAnulacion) {
      await pool.query(
        `UPDATE paquetes SET estado = 'listo_para_retiro', fecha_actualizacion = NOW()
         WHERE id = $1 AND estado NOT IN ('entregado')`,
        [facturaAntes.paquete_id]
      );
      if (facturaAntes.estado === 'pagada' && facturaAntes.fecha_pago) {
        const fechaPagoStr = new Date(facturaAntes.fecha_pago).toISOString().slice(0, 10);
        const cierreDia = await pool.query('SELECT id FROM cierres_caja WHERE fecha = $1', [fechaPagoStr]);
        if (cierreDia.rows.length > 0) {
          const detalle = (req.body.motivo_detalle || '').trim();
          const textoNota = `AJUSTE: Factura ${facturaAntes.numero_factura} anulada (−$${Number(facturaAntes.total).toFixed(2)}) — motivo: ${req.body.motivo}${detalle ? ' · ' + detalle : ''}`;
          await pool.query(
            `UPDATE cierres_caja SET notas = COALESCE(notas || E'\\n', '') || $1 WHERE fecha = $2`,
            [textoNota, fechaPagoStr]
          );
          nota_ajuste = { fecha: fechaPagoStr, texto: textoNota };
        }
      }
    }
    return res.json({ mensaje: 'Estado de factura actualizado', factura: resultado.rows[0], nota_ajuste });
  } catch (error) {
    console.error('Error en PATCH /admin/facturas/:id/estado:', error);
    return res.status(500).json({ mensaje: 'Error interno al actualizar la factura' });
  }
});

// --- GET /api/admin/facturas/:id/pdf ---
router.get('/:id/pdf', async (req, res) => {
  try {
    const resultado = await pool.query(SELECT_FACTURA_PDF, [req.params.id]);
    if (resultado.rows.length === 0) return res.status(404).json({ mensaje: 'Factura no encontrada' });
    const pdfBuffer = await generarPdfFactura(resultado.rows[0]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${resultado.rows[0].numero_factura}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error en GET /admin/facturas/:id/pdf:', error);
    return res.status(500).json({ mensaje: 'Error interno al generar el PDF' });
  }
});

// --- POST /api/admin/facturas/:id/reenviar ---
router.post('/:id/reenviar', async (req, res) => {
  try {
    const resultado = await pool.query(SELECT_FACTURA_PDF, [req.params.id]);
    if (resultado.rows.length === 0) return res.status(404).json({ mensaje: 'Factura no encontrada' });
    const factura = resultado.rows[0];
    if (factura.estado === 'anulada') {
      return res.status(400).json({ mensaje: 'No se puede reenviar una factura anulada.' });
    }
    if (!factura.token_pdf) {
      const nuevoToken = crypto.randomBytes(24).toString('hex');
      await pool.query('UPDATE facturas SET token_pdf = $1 WHERE id = $2', [nuevoToken, factura.id]);
      factura.token_pdf = nuevoToken;
    }
    const envios = { correo_enviado: false, whatsapp_enviado: false, errores_envio: [] };
    try {
      const pdfBuffer = await generarPdfFactura(factura);
      await enviarFacturaPorCorreo(factura.cliente_email, factura.cliente_nombre, factura, pdfBuffer);
      envios.correo_enviado = true;
    } catch (errorCorreo) {
      console.error('Error reenviando factura por correo:', errorCorreo);
      envios.errores_envio.push(`Correo: ${errorCorreo.message}`);
    }
    if (factura.cliente_telefono) {
      try {
        const urlPdfPublica = `${process.env.BASE_URL}/api/public/facturas/${factura.token_pdf}/pdf`;
        await enviarFacturaPorWhatsapp(factura.cliente_telefono, factura, urlPdfPublica);
        envios.whatsapp_enviado = true;
      } catch (errorWhatsapp) {
        console.error('Error reenviando factura por WhatsApp:', errorWhatsapp);
        envios.errores_envio.push(`WhatsApp: ${errorWhatsapp.message}`);
      }
    }
    return res.json({ mensaje: 'Reenvío procesado', envios });
  } catch (error) {
    console.error('Error en POST /admin/facturas/:id/reenviar:', error);
    return res.status(500).json({ mensaje: 'Error interno al reenviar la factura' });
  }
});

// --- POST /api/admin/facturas/generar-y-cobrar ---
router.post(
  '/generar-y-cobrar',
  [
    body('paquete_id').isInt().withMessage('paquete_id es obligatorio'),
    body('tarifa_id').isInt().withMessage('tarifa_id es obligatorio'),
    body('metodo_pago').isIn(['efectivo','tarjeta','transferencia','yappy']).withMessage('Método de pago inválido'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const { paquete_id, tarifa_id, metodo_pago } = req.body;
    const hoy = new Date().toISOString().slice(0, 10);
    const cajaHoy = await pool.query('SELECT id FROM cierres_caja WHERE fecha = $1', [hoy]);
    if (cajaHoy.rows.length > 0) return res.status(409).json({ mensaje: `La caja del ${hoy} ya fue cerrada.`, caja_cerrada: true });
    const client = await pool.connect();
    try {
      const paqueteRes = await client.query('SELECT * FROM paquetes WHERE id = $1', [paquete_id]);
      if (paqueteRes.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      const paquete = paqueteRes.rows[0];
      const tarifaRes = await client.query('SELECT * FROM tarifas WHERE id = $1', [tarifa_id]);
      if (tarifaRes.rows.length === 0) return res.status(404).json({ mensaje: 'Tarifa no encontrada' });
      const tarifa = tarifaRes.rows[0];
      const pesoFacturado = calcularPesoFacturado(paquete, tarifa);
      if (!pesoFacturado || Number(pesoFacturado) === 0) return res.status(400).json({ mensaje: 'El paquete no tiene peso registrado.' });
      const yaFacturado = await client.query(`SELECT id FROM facturas WHERE paquete_id = $1 AND estado <> 'anulada'`, [paquete_id]);
      if (yaFacturado.rows.length > 0) return res.status(409).json({ mensaje: 'Este paquete ya tiene una factura activa.' });
      const costoEnvio = Math.max(Number(pesoFacturado) * Number(tarifa.precio_libra), Number(tarifa.cargo_minimo));
      const seguro = paquete.valor_declarado ? (Number(paquete.valor_declarado) * Number(tarifa.pct_seguro)) / 100 : 0;
      const cargoManejo = Number(tarifa.cargo_manejo);
      const total = costoEnvio + cargoManejo + seguro;
      await client.query('BEGIN');
      const insercion = await client.query(
        `INSERT INTO facturas (paquete_id, usuario_id, tarifa_id, peso_facturado_lb, precio_libra, costo_envio, cargo_manejo, seguro, total, token_pdf, estado, fecha_pago, metodo_pago)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pagada',NOW(),$11) RETURNING *`,
        [paquete_id, paquete.usuario_id, tarifa_id, pesoFacturado, tarifa.precio_libra, costoEnvio.toFixed(2), cargoManejo.toFixed(2), seguro.toFixed(2), total.toFixed(2), crypto.randomBytes(24).toString('hex'), metodo_pago]
      );
      const factura = insercion.rows[0];
      const numeroFactura = generarNumeroFactura(factura.id);
      await client.query('UPDATE facturas SET numero_factura = $1 WHERE id = $2', [numeroFactura, factura.id]);
      await client.query(`UPDATE paquetes SET estado = 'listo_para_retiro', fecha_actualizacion = NOW() WHERE id = $1 AND estado NOT IN ('entregado','listo_para_retiro')`, [paquete_id]);
      await client.query('COMMIT');
      const facturaCompleta = { ...factura, numero_factura: numeroFactura };
      const envios = { correo_enviado: false };
      try {
        const datosCompletos = await pool.query(SELECT_FACTURA_PDF, [factura.id]);
        const fd = datosCompletos.rows[0];
        if (fd) {
          const pdfBuffer = await generarPdfFactura(fd);
          await enviarFacturaPorCorreo(fd.cliente_email, fd.cliente_nombre, fd, pdfBuffer);
          envios.correo_enviado = true;
        }
      } catch (errorCorreo) {
        console.error('Error enviando correo generar-y-cobrar:', errorCorreo);
      }
      return res.status(201).json({ mensaje: 'Factura generada y cobrada.', factura: facturaCompleta, envios });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en POST /admin/facturas/generar-y-cobrar:', error);
      return res.status(500).json({ mensaje: 'Error interno al generar y cobrar la factura' });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
