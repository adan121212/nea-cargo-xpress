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

module.exports = router;
