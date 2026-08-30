const express = require('express');
const { query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');

const router = express.Router();

const ZONA = 'America/Panama';

// Fecha de hoy en Panamá (YYYY-MM-DD). new Date() + toISOString() devuelve
// UTC, y Panamá va 5 horas atrás: de noche el UTC ya cambió de día.
function fechaPanama(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// Resta días a un YYYY-MM-DD sin que se meta la zona horaria del servidor
function restarDias(fechaISO, dias) {
  const [a, m, d] = fechaISO.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  t.setUTCDate(t.getUTCDate() - dias);
  return t.toISOString().slice(0, 10);
}
router.use(requiereAutenticacion, requiereAdmin);

// --- GET /api/admin/reportes ---
// Resumen de operaciones en un rango de fechas.
// Query params opcionales: ?desde=2026-01-01&hasta=2026-01-31 (default: últimos 30 días)
router.get(
  '/',
  [
    query('desde').optional().isISO8601().withMessage('Fecha "desde" inválida'),
    query('hasta').optional().isISO8601().withMessage('Fecha "hasta" inválida'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    // Se trabaja con fechas en texto (YYYY-MM-DD) y la comparación se hace
    // en hora de Panamá dentro de cada consulta, no con objetos Date del
    // servidor, que corren en UTC.
    const hasta = String(req.query.hasta || fechaPanama()).slice(0, 10);
    const desde = String(req.query.desde || restarDias(hasta, 29)).slice(0, 10);

    try {
      const [
        ingresos,
        pendientes,
        paquetesNuevos,
        clientesNuevos,
        paquetesPorEstado,
        ingresosPorDia,
        topClientes,
      ] = await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad
           FROM facturas
           WHERE estado = 'pagada' AND fecha_pago IS NOT NULL
             AND (fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date
                 BETWEEN $1::date AND $2::date`,
          [desde, hasta]
        ),
        pool.query(
          `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad
           FROM facturas WHERE estado = 'pendiente'`
        ),
        pool.query(
          `SELECT COUNT(*) AS cantidad FROM paquetes
           WHERE (fecha_prealerta AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date
                 BETWEEN $1::date AND $2::date`,
          [desde, hasta]
        ),
        pool.query(
          `SELECT COUNT(*) AS cantidad FROM usuarios
           WHERE (fecha_registro AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date
                 BETWEEN $1::date AND $2::date`,
          [desde, hasta]
        ),
        pool.query(`SELECT estado, COUNT(*) AS cantidad FROM paquetes GROUP BY estado`),
        pool.query(
          `SELECT (fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date AS dia,
                  SUM(total) AS total
           FROM facturas
           WHERE estado = 'pagada' AND fecha_pago IS NOT NULL
             AND (fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date
                 BETWEEN $1::date AND $2::date
           GROUP BY 1
           ORDER BY dia ASC`,
          [desde, hasta]
        ),
        pool.query(
          `SELECT u.id, u.nombre, u.apellido, u.email, COUNT(p.id) AS total_paquetes
           FROM usuarios u
           JOIN paquetes p ON p.usuario_id = u.id
           GROUP BY u.id
           ORDER BY total_paquetes DESC
           LIMIT 5`
        ),
      ]);

      return res.json({
        rango: { desde, hasta },
        ingresos: ingresos.rows[0],
        pendientes: pendientes.rows[0],
        paquetes_nuevos: paquetesNuevos.rows[0].cantidad,
        clientes_nuevos: clientesNuevos.rows[0].cantidad,
        paquetes_por_estado: paquetesPorEstado.rows,
        ingresos_por_dia: ingresosPorDia.rows,
        top_clientes: topClientes.rows,
      });
    } catch (error) {
      console.error('Error en GET /admin/reportes:', error);
      return res.status(500).json({ mensaje: 'Error interno al generar el reporte' });
    }
  }
);

module.exports = router;
