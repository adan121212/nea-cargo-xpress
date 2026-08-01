const express = require('express');
const pool = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');
const { generarPdfFactura } = require('../utils/facturaPdf');

const router = express.Router();

// --- GET /api/facturas ---
// Lista las facturas del usuario autenticado.
router.get('/', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT f.*, p.tienda, p.numero_tracking
       FROM facturas f
       JOIN paquetes p ON p.id = f.paquete_id
       WHERE f.usuario_id = $1
       ORDER BY f.fecha_creacion DESC`,
      [req.usuario.id]
    );
    return res.json({ facturas: resultado.rows });
  } catch (error) {
    console.error('Error en GET /facturas:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar facturas' });
  }
});

// --- GET /api/facturas/:id ---
// Detalle de una factura, solo si pertenece al usuario autenticado.
router.get('/:id', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT f.*, p.tienda, p.numero_tracking, p.descripcion
       FROM facturas f
       JOIN paquetes p ON p.id = f.paquete_id
       WHERE f.id = $1 AND f.usuario_id = $2`,
      [req.params.id, req.usuario.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Factura no encontrada' });
    }

    return res.json({ factura: resultado.rows[0] });
  } catch (error) {
    console.error('Error en GET /facturas/:id:', error);
    return res.status(500).json({ mensaje: 'Error interno al obtener la factura' });
  }
});

// --- GET /api/facturas/:id/pdf ---
// Descarga el PDF de una factura propia (requiere sesión iniciada).
router.get('/:id/pdf', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
              u.email AS cliente_email, u.numero_casillero, p.tienda, p.numero_tracking
       FROM facturas f
       JOIN usuarios u ON u.id = f.usuario_id
       JOIN paquetes p ON p.id = f.paquete_id
       WHERE f.id = $1 AND f.usuario_id = $2`,
      [req.params.id, req.usuario.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Factura no encontrada' });
    }

    const pdfBuffer = await generarPdfFactura(resultado.rows[0]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${resultado.rows[0].numero_factura}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error en GET /facturas/:id/pdf:', error);
    return res.status(500).json({ mensaje: 'Error interno al generar el PDF' });
  }
});

module.exports = router;
