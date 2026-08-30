const express = require('express');
const { query, body, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { enviarCorreoGenerico } = require('../../utils/mailer');
const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

const ZONA = 'America/Panama';

/**
 * Fecha de hoy en Panamá (YYYY-MM-DD).
 * No se puede usar toISOString() porque devuelve UTC, y Panamá va 5 horas
 * atrás: después de las 7:00 PM local el UTC ya cambió de día.
 */
function fechaPanama(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Hora legible (11:03 p. m.) de un timestamp, en hora de Panamá. */
function horaPanama(valor) {
  if (!valor) return '—';
  return new Date(valor).toLocaleTimeString('es-PA', {
    timeZone: ZONA, hour: '2-digit', minute: '2-digit',
  });
}

/** "19 de agosto de 2026" a partir de un YYYY-MM-DD, sin depender de zonas. */
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function fechaLarga(fechaISO) {
  const [anio, mes, dia] = String(fechaISO).slice(0, 10).split('-');
  return `${Number(dia)} de ${MESES[Number(mes) - 1]} de ${anio}`;
}

const METODO_LABEL = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  yappy: 'Yappy',
};

/**
 * Resumen de lo cobrado en un día.
 *
 * fecha_pago es "timestamp without time zone" y guarda la hora UTC.
 * Para saber a qué día de Panamá pertenece hay que interpretarlo como UTC
 * y después pasarlo a hora local. Usar DATE(fecha_pago) directo mandaba
 * todo lo cobrado después de las 7:00 PM al día siguiente.
 */
async function calcularResumenDia(fecha) {
  const porMetodo = await pool.query(
    `SELECT COALESCE(metodo_pago, 'sin_especificar') AS metodo_pago,
            SUM(total) AS total, COUNT(*) AS cantidad
     FROM facturas
     WHERE estado = 'pagada'
       AND fecha_pago IS NOT NULL
       AND (fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date = $1::date
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
  // Comisiones del Servicio Profesional de Compras cobradas ese día.
  // Solo entra la comisión: el monto del producto es un reembolso, no una venta.
  const compras = await pool.query(
    `SELECT COALESCE(metodo_pago, 'sin_especificar') AS metodo_pago,
            SUM(comision) AS total, COUNT(*) AS cantidad
     FROM compras
     WHERE estado = 'pagada'
       AND fecha_pago IS NOT NULL
       AND (fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date = $1::date
     GROUP BY metodo_pago`,
    [fecha]
  );

  // Se juntan con las facturas por método, porque en la gaveta el dinero es el mismo
  compras.rows.forEach((c) => {
    const existente = detalle.find((d) => d.metodo_pago === c.metodo_pago);
    if (existente) {
      existente.total += Number(c.total);
      existente.cantidad += Number(c.cantidad);
    } else {
      detalle.push({
        metodo_pago: c.metodo_pago,
        etiqueta: METODO_LABEL[c.metodo_pago] || c.metodo_pago,
        total: Number(c.total),
        cantidad: Number(c.cantidad),
      });
    }
  });
  detalle.sort((a, b) => b.total - a.total);

  const totalComisiones = compras.rows.reduce((a, c) => a + Number(c.total), 0);
  const cantidadCompras = compras.rows.reduce((a, c) => a + Number(c.cantidad), 0);

  const totalGeneral = detalle.reduce((acum, d) => acum + d.total, 0);
  const cantidadFacturas = detalle.reduce((acum, d) => acum + d.cantidad, 0);
  return {
    detalle, totalGeneral, cantidadFacturas,
    desglose: {
      flete: totalGeneral - totalComisiones,
      comisiones_compras: totalComisiones,
      cantidad_compras: cantidadCompras,
    },
  };
}

// --- GET /api/admin/caja/dia?fecha=2026-08-19 ---
router.get(
  '/dia',
  [query('fecha').optional().isISO8601().withMessage('Fecha inválida')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const fecha = req.query.fecha || fechaPanama();
    try {
      const { detalle, totalGeneral, cantidadFacturas, desglose } = await calcularResumenDia(fecha);
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
        cantidad_facturas: cantidadFacturas, desglose,
        cerrado: cierreActualizado !== null, cierre: cierreActualizado,
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

// --- GET /api/admin/caja/facturas-dia?fecha=2026-08-19 ---
// Las facturas cobradas ese día, ya filtradas en hora de Panamá.
router.get(
  '/facturas-dia',
  [query('fecha').isISO8601().withMessage('Fecha inválida')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      const resultado = await pool.query(
        `SELECT f.id, f.numero_factura, f.total, f.metodo_pago, f.fecha_pago,
                u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                p.tienda, p.numero_tracking
         FROM facturas f
         JOIN usuarios u ON u.id = f.usuario_id
         JOIN paquetes p ON p.id = f.paquete_id
         WHERE f.estado = 'pagada'
           AND f.fecha_pago IS NOT NULL
           AND (f.fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date = $1::date
         ORDER BY f.fecha_pago ASC`,
        [req.query.fecha]
      );
      return res.json({ facturas: resultado.rows });
    } catch (error) {
      console.error('Error en GET /admin/caja/facturas-dia:', error);
      return res.status(500).json({ mensaje: 'Error interno al listar las facturas del día' });
    }
  }
);

// --- POST /api/admin/caja/enviar-reporte ---
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
      const fechaLegible = fechaLarga(fecha);
      const horaLegible = cierre ? horaPanama(cierre.fecha_cierre) : '—';
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
            <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:4px;">Miami &rarr; Panam&aacute;</div>
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
                  <th style="padding:10px 14px;text-align:left;">M&eacute;todo de pago</th>
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
            NEA Cargo Xpress — Sistema de casillero &middot; Generado autom&aacute;ticamente
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
