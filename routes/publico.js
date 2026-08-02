const express = require('express');
const pool = require('../db');
const { generarPdfFactura } = require('../utils/facturaPdf');

const router = express.Router();

// --- GET /api/public/facturas/:token/pdf ---
// Sin login: protegido únicamente por un token aleatorio de 48 caracteres
// (imposible de adivinar). Se usa para que WhatsApp/Twilio pueda descargar
// el PDF, y también sirve como link para compartir la factura directamente.
router.get('/facturas/:token/pdf', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
              u.email AS cliente_email, u.numero_casillero, p.tienda, p.numero_tracking
       FROM facturas f
       JOIN usuarios u ON u.id = f.usuario_id
       JOIN paquetes p ON p.id = f.paquete_id
       WHERE f.token_pdf = $1`,
      [req.params.token]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).send('Factura no encontrada.');
    }

    const pdfBuffer = await generarPdfFactura(resultado.rows[0]);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${resultado.rows[0].numero_factura}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error en GET /public/facturas/:token/pdf:', error);
    return res.status(500).send('Error interno al generar el PDF.');
  }
});

// --- GET /api/public/rastreo/:tracking ---
// Sin login: cualquiera con el número de tracking puede ver el estado.
// No expone datos privados del cliente (nombre, correo, casillero, valor declarado).
router.get('/rastreo/:tracking', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT p.id, p.tienda, p.numero_tracking, p.estado, p.fecha_prealerta, p.fecha_actualizacion
       FROM paquetes p
       WHERE p.numero_tracking ILIKE $1
       ORDER BY p.fecha_prealerta DESC
       LIMIT 1`,
      [req.params.tracking.trim()]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'No encontramos ningún paquete con ese número de tracking.' });
    }

    const paquete = resultado.rows[0];

    const fotos = await pool.query(
      'SELECT url FROM paquete_fotos WHERE paquete_id = $1 ORDER BY fecha_subida ASC',
      [paquete.id]
    );

    return res.json({
      tienda: paquete.tienda,
      numero_tracking: paquete.numero_tracking,
      estado: paquete.estado,
      fecha_prealerta: paquete.fecha_prealerta,
      fecha_actualizacion: paquete.fecha_actualizacion,
      fotos: fotos.rows.map((f) => f.url),
    });
  } catch (error) {
    console.error('Error en GET /public/rastreo/:tracking:', error);
    return res.status(500).json({ mensaje: 'Error interno al rastrear el paquete.' });
  }
});

module.exports = router;
