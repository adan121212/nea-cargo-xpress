const express = require('express');
const { query, body, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// Etiquetas legibles para cada método de pago conocido.
// Cualquier valor que no esté aquí (ej. datos viejos con otro método)
// se muestra tal cual, así nunca se pierde un cobro del reporte.
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
// Resumen del día. Si ese día YA fue cerrado antes, sincroniza automáticamente
// el cierre guardado con los cobros reales de ahora mismo (por si se cobró
// algo después del cierre) — así el cierre nunca queda desactualizado, sin
// necesidad de que el admin haga nada extra.
router.get(
  '/dia',
  [query('fecha').optional().isISO8601().withMessage('Fecha inválida')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);

    try {
      const { detalle, totalGeneral, cantidadFacturas } = await calcularResumenDia(fecha);

      const cierreExistente = await pool.query('SELECT id FROM cierres_caja WHERE fecha = $1', [fecha]);

      let cierreActualizado = null;
      if (cierreExistente.rows.length > 0) {
        // Ya estaba cerrado: sincroniza los totales guardados con la realidad actual.
        const actualizado = await pool.query(
          `UPDATE cierres_caja
           SET detalle_por_metodo = $1, total_general = $2, cantidad_facturas = $3, actualizado_en = NOW()
           WHERE fecha = $4
           RETURNING *`,
          [JSON.stringify(detalle), totalGeneral, cantidadFacturas, fecha]
        );

        const conNombre = await pool.query(
          `SELECT c.*, u.nombre AS cerrado_por_nombre, u.apellido AS cerrado_por_apellido
           FROM cierres_caja c
           LEFT JOIN usuarios u ON u.id = c.cerrado_por
           WHERE c.fecha = $1`,
          [fecha]
        );
        cierreActualizado = conNombre.rows[0];
      }

      return res.json({
        fecha,
        detalle_por_metodo: detalle,
        total_general: totalGeneral,
        cantidad_facturas: cantidadFacturas,
        cerrado: cierreActualizado !== null,
        cierre: cierreActualizado,
      });
    } catch (error) {
      console.error('Error en GET /admin/caja/dia:', error);
      return res.status(500).json({ mensaje: 'Error interno al calcular el resumen de caja' });
    }
  }
);

// --- POST /api/admin/caja/cerrar ---
// Marca el día como cerrado por primera vez (registra quién y cuándo).
// Si ya estaba cerrado, no se puede "re-cerrar" manualmente — pero no hace
// falta: los totales se sincronizan solos cada vez que se consulta el día
// (ver GET /dia), así que el cierre existente siempre refleja la realidad.
router.post(
  '/cerrar',
  [
    body('fecha').isISO8601().withMessage('Fecha inválida'),
    body('notas').optional({ checkFalsy: true }).trim(),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { fecha, notas } = req.body;

    try {
      const yaExiste = await pool.query('SELECT id FROM cierres_caja WHERE fecha = $1', [fecha]);
      if (yaExiste.rows.length > 0) {
        return res.status(409).json({ mensaje: `El día ${fecha} ya fue cerrado anteriormente.` });
      }

      const { detalle, totalGeneral, cantidadFacturas } = await calcularResumenDia(fecha);

      const resultado = await pool.query(
        `INSERT INTO cierres_caja (fecha, cerrado_por, detalle_por_metodo, total_general, cantidad_facturas, notas, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING *`,
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
// Lista de cierres pasados, más reciente primero.
router.get('/historial', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT c.*, u.nombre AS cerrado_por_nombre, u.apellido AS cerrado_por_apellido
       FROM cierres_caja c
       LEFT JOIN usuarios u ON u.id = c.cerrado_por
       ORDER BY c.fecha DESC
       LIMIT 60`
    );
    return res.json({ cierres: resultado.rows });
  } catch (error) {
    console.error('Error en GET /admin/caja/historial:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar el historial de caja' });
  }
});

module.exports = router;
