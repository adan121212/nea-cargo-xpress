const express = require('express');
const pool = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');
const { generarPdfFactura } = require('../utils/facturaPdf');

const router = express.Router();

// Todas las rutas de este archivo son del CLIENTE.
// Cada consulta filtra por req.usuario.id: un cliente solo ve lo suyo.
router.use(requiereAutenticacion);

// --- GET /api/facturas/metodos-pago ---
// Le dice al app qué botones de pago mostrar.
// Va ANTES de /:id para que no lo capture esa ruta.
router.get('/metodos-pago', (req, res) => {
  return res.json({
    yappy: Boolean(process.env.YAPPY_MERCHANT_ID && process.env.YAPPY_SECRET_KEY),
  });
});

// --- GET /api/facturas ---
// Solo las facturas del cliente autenticado.
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT f.id, f.numero_factura, f.paquete_id, f.tarifa_id,
              f.peso_facturado_lb, f.precio_libra, f.costo_envio, f.cargo_manejo,
              f.seguro, f.total, f.estado, f.fecha_creacion, f.fecha_pago,
              f.metodo_pago,
              p.tienda, p.numero_tracking, p.estado AS paquete_estado
       FROM facturas f
       JOIN paquetes p ON p.id = f.paquete_id
       WHERE f.usuario_id = $1
       ORDER BY f.fecha_creacion DESC`,
      [req.usuario.id]
    );
    return res.json({ facturas: resultado.rows });
  } catch (error) {
    console.error('Error en GET /facturas:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar tus facturas' });
  }
});

// --- GET /api/facturas/:id ---
router.get('/:id', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT f.id, f.numero_factura, f.paquete_id, f.peso_facturado_lb, f.precio_libra,
              f.costo_envio, f.cargo_manejo, f.seguro, f.total, f.estado,
              f.fecha_creacion, f.fecha_pago, f.metodo_pago,
              p.tienda, p.numero_tracking, p.estado AS paquete_estado
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
// El cliente solo puede descargar el PDF de SUS facturas.
router.get('/:id/pdf', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
              u.email AS cliente_email, u.telefono AS cliente_telefono,
              u.ruc AS cliente_ruc, u.numero_casillero,
              p.tienda, p.numero_tracking, p.firma_base64, p.fecha_entrega,
              p.largo_in, p.ancho_in, p.alto_in, p.peso_volumetrico_lb, p.peso_real_lb
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
    res.setHeader('Content-Disposition', `inline; filename="${resultado.rows[0].numero_factura}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error en GET /facturas/:id/pdf:', error);
    return res.status(500).json({ mensaje: 'Error interno al generar el PDF' });
  }
});

// --- POST /api/facturas/:id/pagar-yappy ---
// Genera el link de pago. Solo para facturas propias y pendientes.
router.post('/:id/pagar-yappy', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT f.*, u.nombre AS cliente_nombre, u.telefono AS cliente_telefono
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
      return res.status(409).json({ mensaje: 'Esta factura ya no está pendiente de pago.' });
    }
    let crearOrdenYappy;
    try {
      ({ crearOrdenYappy } = require('../utils/yappy'));
    } catch (e) {
      return res.status(503).json({ mensaje: 'El pago con Yappy no está disponible por ahora.' });
    }
    const orden = await crearOrdenYappy(factura);
    return res.json({ url: orden.url });
  } catch (error) {
    console.error('Error en POST /facturas/:id/pagar-yappy:', error);
    return res.status(500).json({ mensaje: 'No se pudo iniciar el pago con Yappy.' });
  }
});

module.exports = router;
