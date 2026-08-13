const express = require('express');
const { query, body, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { enviarCorreoGenerico } = require('../../utils/mailer');
const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

const METODO_LABEL = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  yappy: 'Yappy',
};

async function calcularResumenDia(fecha) {
  const porMetodo = await pool.query(
    `SELECT COALESCE(metodo_pago, 'sin_especificar') AS metodo_pago,
            SUM(total) AS total, COUNT(*) AS cantidad
     FROM facturas
     WHERE estado = 'pagada' AND DATE(fecha_pago) = $1
     GROUP BY metodo_pago
     ORDER BY total DESC`,
    [fecha]
  );
  const detalle = porMetodo.rows.map((r) => ({
    metodo_pago: r.metodo_pago,
    etiqueta: METODO_LABEL[r.metodo_pago] || r.metodo_pago,
    total: Number(r.total),
    cantidad: Number(r.cantidad),
  }));
  const totalGeneral = detalle.reduce((acum, d) => acum + d.total, 0);
  const cantidadFacturas = detalle.reduce((acum, d) => acum + d.cantidad, 0);
  return { detalle, totalGeneral, cantidadFacturas };
}

// --- GET /api/admin/caja/dia?fecha=2026-08-04 ---
router.get(
  '/dia',
  [query('fecha').optional().isISO8601().withMessage('Fecha inválida')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
    try {
      const { detalle, totalGeneral, cantidadFacturas } = await calcularResumenDia(fecha);
      const cierreExistente = await pool.query('SELECT id FROM cierres_caja WHERE fecha = $1', [fecha]);
      let cierreActualizado = null;
      if (cierreExistente.rows.length > 0) {
        await pool.query(
          `UPDATE cierres_caja SET detalle_por_metodo=$1, total_general=$2, cantidad_facturas=$3, actualizado_en=NOW() WHERE fecha=$4`,
          [JSON.stringify(detalle), totalGeneral, cantidadFacturas, fecha]
        );
        const conNombre = await pool.query(
          `SELECT c.*, u.nombre AS cerrado_por_nombre, u.apellido AS cerrado_por_apellido
           FROM cierres_caja c LEFT JOIN usuarios u ON u.id = c.cerrado_por WHERE c.fecha=$1`,
          [fecha]
        );
        cierreActualizado = conNombre.rows[0];
      }
      return res.json({
        fecha, detalle_por_metodo: detalle, total_general: totalGeneral,
        cantidad_facturas: cantidadFacturas, cerrado: cierreActualizado !== null, cierre: cierreActualizado,
      });
    } catch (error) {
      console.error('Error en GET /admin/caja/dia:', error);
      return res.status(500).json({ mensaje: 'Error interno al calcular el resumen de caja' });
    }
  }
);

// --- POST /api/admin/caja/cerrar ---
router.post(
  '/cerrar',
  [body('fecha').isISO8601().withMessage('Fecha inválida'), body('notas').optional({ checkFalsy: true }).trim()],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const { fecha, notas } = req.body;
    try {
      const yaExiste = await pool.query('SELECT id FROM cierres_caja WHERE fecha=$1', [fecha]);
      if (yaExiste.rows.length > 0) return res.status(409).json({ mensaje: `El día ${fecha} ya fue cerrado anteriormente.` });
      const { detalle, totalGeneral, cantidadFacturas } = await calcularResumenDia(fecha);
      const resultado = await pool.query(
        `INSERT INTO cierres_caja (fecha, cerrado_por, detalle_por_metodo, total_general, cantidad_facturas, notas, actualizado_en)
         VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
        [fecha, req.usuario.id, JSON.stringify(detalle), totalGeneral, cantidadFacturas, notas || null]
      );
      return res.status(201).json({ mensaje: 'Caja cerrada correctamente', cierre: resultado.rows[0] });
    } catch (error) {
      console.error('Error en POST /admin/caja/cerrar:', error);
      return res.status(500).json({ mensaje: 'Error interno al cerrar la caja' });
    }
  }
);

// --- GET /api/admin/caja/historial ---
router.get('/historial', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT c.*, u.nombre AS cerrado_por_nombre, u.apellido AS cerrado_por_apellido
       FROM cierres_caja c LEFT JOIN usuarios u ON u.id = c.cerrado_por
       ORDER BY c.fecha DESC LIMIT 60`
    );
    return res.json({ cierres: resultado.rows });
  } catch (error) {
    console.error('Error en GET /admin/caja/historial:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar el historial de caja' });
  }
});

// --- POST /api/admin/caja/enviar-reporte ---
// Envía el resumen del cierre de caja a un correo indicado.
router.post(
  '/enviar-reporte',
  [
    body('fecha').isISO8601().withMessage('Fecha inválida'),
    body('correo').isEmail().withMessage('Correo inválido'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const { fecha, correo } = req.body;
    try {
      const { detalle, totalGeneral, cantidadFacturas } = await calcularResumenDia(fecha);
      const cierreRes = await pool.query(
        `SELECT c.*, u.nombre AS cerrado_por_nombre, u.apellido AS cerrado_por_apellido
         FROM cierres_caja c LEFT JOIN usuarios u ON u.id = c.cerrado_por WHERE c.fecha=$1`,
        [fecha]
      );
      const cierre = cierreRes.rows[0];
      const fechaLegible = new Date(fecha).toLocaleDateString('es-PA', { day: '2-digit', month: 'long', year: 'numeric' });
      const horaLegible = cierre ? new Date(cierre.fecha_cierre).toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' }) : '—';
      const cerradoPor = cierre ? `${cierre.cerrado_por_nombre || ''} ${cierre.cerrado_por_apellido || ''}`.trim() : '—';

      const filasMetodos = detalle.map(m => `
        <tr>
          <td style="padding:8px 14px;border-bottom:1px solid #e5e7eb;">${m.etiqueta}</td>
          <td style="padding:8px 14px;border-bottom:1px solid #e5e7eb;text-align:center;">${m.cantidad}</td>
          <td style="padding:8px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">$${m.total.toFixed(2)}</td>
        </tr>`).join('');

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <div style="background:#0c1b33;color:#fff;padding:20px 24px;text-align:center;">
            <div style="font-size:20px;font-weight:700;letter-spacing:.02em;">NEA CARGO XPRESS</div>
            <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:4px;">Miami → Panamá</div>
          </div>
          <div style="padding:24px;">
            <h2 style="font-size:16px;margin:0 0 16px;color:#0c1b33;border-bottom:2px solid #0c1b33;padding-bottom:8px;">CIERRE DE CAJA — ${fechaLegible}</h2>
            <table style="width:100%;font-size:13px;margin-bottom:16px;border-collapse:collapse;">
              <tr><td style="padding:4px 0;color:#666;">Fecha:</td><td style="font-weight:600;">${fechaLegible}</td></tr>
              <tr><td style="padding:4px 0;color:#666;">Hora de cierre:</td><td style="font-weight:600;">${horaLegible}</td></tr>
              <tr><td style="padding:4px 0;color:#666;">Cerrado por:</td><td style="font-weight:600;">${cerradoPor}</td></tr>
              <tr><td style="padding:4px 0;color:#666;">Total facturas:</td><td style="font-weight:600;">${cantidadFacturas}</td></tr>
            </table>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="background:#0c1b33;color:#fff;">
                  <th style="padding:10px 14px;text-align:left;">Método de pago</th>
                  <th style="padding:10px 14px;text-align:center;">Facturas</th>
                  <th style="padding:10px 14px;text-align:right;">Total</th>
                </tr>
              </thead>
              <tbody>${filasMetodos}</tbody>
              <tfoot>
                <tr style="background:#f9fafb;">
                  <td colspan="2" style="padding:12px 14px;font-weight:700;font-size:15px;">TOTAL COBRADO</td>
                  <td style="padding:12px 14px;font-weight:700;font-size:15px;text-align:right;color:#177a63;">$${totalGeneral.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
            ${cierre?.notas ? `<div style="margin-top:16px;padding:12px 14px;background:#f9fafb;border-radius:8px;font-size:12px;"><strong>Notas:</strong><br>${cierre.notas}</div>` : ''}
          </div>
          <div style="background:#f9fafb;padding:14px 24px;text-align:center;font-size:11px;color:#999;border-top:1px solid #e5e7eb;">
            NEA Cargo Xpress — Sistema de casillero · Generado automáticamente
          </div>
        </div>`;

      await enviarCorreoGenerico(correo, `Cierre de caja — ${fechaLegible}`, html);
      return res.json({ mensaje: 'Reporte enviado correctamente.' });
    } catch (error) {
      console.error('Error en POST /admin/caja/enviar-reporte:', error);
      return res.status(500).json({ mensaje: 'Error interno al enviar el reporte.' });
    }
  }
);

module.exports = router;
