const express = require('express');
const pool = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');
const { generarPdfFactura } = require('../utils/facturaPdf');
const { generarEnlacePago } = require('../utils/paguelofacil');
const { clienteYappyDisponible, generarEnlacePagoYappy } = require('../utils/yappy');

const router = express.Router();

// --- GET /api/facturas/metodos-pago ---
// Le dice al frontend qué botones de pago mostrar (Yappy puede no estar
// configurado todavía). IMPORTANTE: esta ruta va ANTES que cualquier ruta
// "/:id", si no Express interpretaría "metodos-pago" como un id.
router.get('/metodos-pago', requiereAutenticacion, async (req, res) => {
  return res.json({
    paguelofacil: true,
    yappy: clienteYappyDisponible(),
  });
});

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
              u.email AS cliente_email, u.numero_casillero, p.tienda, p.numero_tracking,
              p.firma_base64, p.fecha_entrega
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

// --- POST /api/facturas/:id/pagar ---
// Genera un enlace de pago (PagueloFacil) para una factura propia y pendiente.
// El frontend debe redirigir al navegador a la "url" que devuelve este endpoint.
router.post('/:id/pagar', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT id, numero_factura, total, estado
       FROM facturas WHERE id = $1 AND usuario_id = $2`,
      [req.params.id, req.usuario.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Factura no encontrada' });
    }

    const factura = resultado.rows[0];

    if (factura.estado !== 'pendiente') {
      return res.status(400).json({ mensaje: `Esta factura ya está en estado "${factura.estado}", no se puede pagar de nuevo.` });
    }

    const enlace = await generarEnlacePago(factura);
    return res.json({ url: enlace.url });
  } catch (error) {
    console.error('Error en POST /facturas/:id/pagar:', error);
    return res.status(500).json({ mensaje: 'No se pudo generar el enlace de pago. Intenta de nuevo.' });
  }
});

// --- POST /api/facturas/:id/pagar-yappy ---
// Igual que /pagar, pero genera el enlace con Yappy (Banco General) en vez
// de PagueloFacil. Solo funciona si ya configuraste YAPPY_MERCHANT_ID /
// YAPPY_SECRET_KEY (ver utils/yappy.js).
router.post('/:id/pagar-yappy', requiereAutenticacion, async (req, res) => {
  if (!clienteYappyDisponible()) {
    return res.status(503).json({ mensaje: 'El pago con Yappy todavía no está configurado en este sistema.' });
  }

  try {
    const resultado = await pool.query(
      `SELECT f.id, f.numero_factura, f.total, f.estado, u.telefono AS cliente_telefono
       FROM facturas f
       JOIN usuarios u ON u.id = f.usuario_id
       WHERE f.id = $1 AND f.usuario_id = $2`,
      [req.params.id, req.usuario.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Factura no encontrada' });
    }

    const factura = resultado.rows[0];

    if (factura.estado !== 'pendiente') {
      return res.status(400).json({ mensaje: `Esta factura ya está en estado "${factura.estado}", no se puede pagar de nuevo.` });
    }

    const enlace = await generarEnlacePagoYappy(factura);
    return res.json({ url: enlace.url });
  } catch (error) {
    console.error('Error en POST /facturas/:id/pagar-yappy:', error);
    return res.status(500).json({ mensaje: 'No se pudo generar el enlace de pago con Yappy. Intenta de nuevo.' });
  }
});

module.exports = router;
