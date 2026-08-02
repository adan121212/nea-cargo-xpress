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

// --- POST /api/admin/facturas ---
// Genera la factura de un paquete usando una tarifa específica.
// body: { paquete_id, tarifa_id }
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
    const client = await pool.connect();

    try {
      const paqueteRes = await client.query('SELECT * FROM paquetes WHERE id = $1', [paquete_id]);
      if (paqueteRes.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      }
      const paquete = paqueteRes.rows[0];

      const pesoFacturado = paquete.peso_real_lb ?? paquete.peso_lb;
      if (!pesoFacturado) {
        return res.status(400).json({
          mensaje: 'Este paquete no tiene un peso registrado. Confirma el peso real antes de facturar.',
        });
      }

      const tarifaRes = await client.query('SELECT * FROM tarifas WHERE id = $1', [tarifa_id]);
      if (tarifaRes.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Tarifa no encontrada' });
      }
      const tarifa = tarifaRes.rows[0];

      const yaFacturado = await client.query(
        `SELECT id FROM facturas WHERE paquete_id = $1 AND estado <> 'anulada'`,
        [paquete_id]
      );
      if (yaFacturado.rows.length > 0) {
        return res.status(409).json({ mensaje: 'Este paquete ya tiene una factura activa.' });
      }

      const costoEnvio = Math.max(
        Number(pesoFacturado) * Number(tarifa.precio_libra),
        Number(tarifa.cargo_minimo)
      );
      const seguro = paquete.valor_declarado
        ? (Number(paquete.valor_declarado) * Number(tarifa.pct_seguro)) / 100
        : 0;
      const cargoManejo = Number(tarifa.cargo_manejo);
      const total = costoEnvio + cargoManejo + seguro;

      await client.query('BEGIN');

      const insercion = await client.query(
        `INSERT INTO facturas
           (paquete_id, usuario_id, tarifa_id, peso_facturado_lb, precio_libra,
            costo_envio, cargo_manejo, seguro, total, token_pdf)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          paquete_id,
          paquete.usuario_id,
          tarifa_id,
          pesoFacturado,
          tarifa.precio_libra,
          costoEnvio.toFixed(2),
          cargoManejo.toFixed(2),
          seguro.toFixed(2),
          total.toFixed(2),
          crypto.randomBytes(24).toString('hex'),
        ]
      );

      const factura = insercion.rows[0];
      const numeroFactura = generarNumeroFactura(factura.id);

      await client.query('UPDATE facturas SET numero_factura = $1 WHERE id = $2', [
        numeroFactura,
        factura.id,
      ]);
      await client.query('COMMIT');

      const facturaCompleta = { ...factura, numero_factura: numeroFactura };

      // Trae los datos del cliente y del paquete para el PDF y los mensajes.
      const datosCompletos = await pool.query(
        `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                u.email AS cliente_email, u.telefono AS cliente_telefono, u.numero_casillero,
                p.tienda, p.numero_tracking, p.firma_base64, p.fecha_entrega
         FROM facturas f
         JOIN usuarios u ON u.id = f.usuario_id
         JOIN paquetes p ON p.id = f.paquete_id
         WHERE f.id = $1`,
        [factura.id]
      );
      const facturaParaEnvio = datosCompletos.rows[0];

      const envios = { correo_enviado: false, whatsapp_enviado: false, errores_envio: [] };

      // Correo con PDF adjunto (no bloquea la respuesta si falla).
      try {
        const pdfBuffer = await generarPdfFactura(facturaParaEnvio);
        await enviarFacturaPorCorreo(
          facturaParaEnvio.cliente_email,
          facturaParaEnvio.cliente_nombre,
          facturaParaEnvio,
          pdfBuffer
        );
        envios.correo_enviado = true;
      } catch (errorCorreo) {
        console.error('Error enviando factura por correo:', errorCorreo);
        envios.errores_envio.push(`Correo: ${errorCorreo.message}`);
      }

      // WhatsApp con el link al PDF (solo si el cliente tiene teléfono y Twilio está configurado).
      if (facturaParaEnvio.cliente_telefono) {
        try {
          const urlPdfPublica = `${process.env.BASE_URL}/api/public/facturas/${facturaParaEnvio.token_pdf}/pdf`;
          await enviarFacturaPorWhatsapp(facturaParaEnvio.cliente_telefono, facturaParaEnvio, urlPdfPublica);
          envios.whatsapp_enviado = true;
        } catch (errorWhatsapp) {
          console.error('Error enviando factura por WhatsApp:', errorWhatsapp);
          envios.errores_envio.push(`WhatsApp: ${errorWhatsapp.message}`);
        }
      } else {
        envios.errores_envio.push('WhatsApp: el cliente no tiene teléfono registrado.');
      }

      return res.status(201).json({
        mensaje: 'Factura generada',
        factura: facturaCompleta,
        envios,
      });
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
// Lista todas las facturas, con filtros opcionales: ?estado=pendiente&email=ana@ejemplo.com
router.get(
  '/',
  [
    query('estado').optional().isIn(['pendiente', 'pagada', 'anulada']),
    query('email').optional().trim(),
  ],
  async (req, res) => {
    const { estado, email } = req.query;
    const condiciones = [];
    const valores = [];

    if (estado) {
      valores.push(estado);
      condiciones.push(`f.estado = $${valores.length}`);
    }
    if (email) {
      valores.push(`%${email}%`);
      condiciones.push(`u.email ILIKE $${valores.length}`);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    try {
      const resultado = await pool.query(
        `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido, u.email AS cliente_email,
                p.tienda, p.numero_tracking
         FROM facturas f
         JOIN usuarios u ON u.id = f.usuario_id
         JOIN paquetes p ON p.id = f.paquete_id
         ${where}
         ORDER BY f.fecha_creacion DESC
         LIMIT 200`,
        valores
      );
      return res.json({ facturas: resultado.rows });
    } catch (error) {
      console.error('Error en GET /admin/facturas:', error);
      return res.status(500).json({ mensaje: 'Error interno al listar facturas' });
    }
  }
);

// --- PATCH /api/admin/facturas/:id/estado ---
// Marca una factura como pagada o anulada.
router.patch(
  '/:id/estado',
  [body('estado').isIn(['pendiente', 'pagada', 'anulada']).withMessage('Estado inválido')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const fechaPago = req.body.estado === 'pagada' ? 'NOW()' : 'NULL';

    try {
      const resultado = await pool.query(
        `UPDATE facturas SET estado = $1, fecha_pago = ${fechaPago} WHERE id = $2 RETURNING *`,
        [req.body.estado, req.params.id]
      );

      if (resultado.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Factura no encontrada' });
      }

      return res.json({ mensaje: 'Estado de factura actualizado', factura: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/facturas/:id/estado:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar la factura' });
    }
  }
);

// --- GET /api/admin/facturas/:id/pdf ---
// El admin puede ver el PDF de cualquier factura (no solo las propias).
router.get('/:id/pdf', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
              u.email AS cliente_email, u.numero_casillero, p.tienda, p.numero_tracking,
              p.firma_base64, p.fecha_entrega
       FROM facturas f
       JOIN usuarios u ON u.id = f.usuario_id
       JOIN paquetes p ON p.id = f.paquete_id
       WHERE f.id = $1`,
      [req.params.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Factura no encontrada' });
    }

    const pdfBuffer = await generarPdfFactura(resultado.rows[0]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${resultado.rows[0].numero_factura}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error en GET /admin/facturas/:id/pdf:', error);
    return res.status(500).json({ mensaje: 'Error interno al generar el PDF' });
  }
});

module.exports = router;
