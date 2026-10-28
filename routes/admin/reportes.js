const express = require('express');
const { query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { ZONA, fechaPanama, restarDias } = require('../../utils/fechas');

const router = express.Router();



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

// --- GET /api/admin/reportes/facturacion ---
// Todo lo facturado en un rango de fechas (por fecha de creación de la factura,
// en hora de Panamá). Params opcionales: ?desde=&hasta=&estado=pagada|pendiente|anulada
// Sin desde/hasta devuelve TODO el historial.
router.get(
  '/facturacion',
  [
    query('desde').optional({ checkFalsy: true }).isISO8601().withMessage('Fecha "desde" inválida'),
    query('hasta').optional({ checkFalsy: true }).isISO8601().withMessage('Fecha "hasta" inválida'),
    query('estado').optional({ checkFalsy: true }).isIn(['pagada', 'pendiente', 'anulada']).withMessage('Estado inválido'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const desde = req.query.desde ? String(req.query.desde).slice(0, 10) : null;
    const hasta = req.query.hasta ? String(req.query.hasta).slice(0, 10) : null;
    const estado = req.query.estado || null;

    const dia = `(f.fecha_creacion AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date`;
    const filtro = `WHERE ($1::date IS NULL OR ${dia} >= $1::date)
                      AND ($2::date IS NULL OR ${dia} <= $2::date)
                      AND ($3::text IS NULL OR f.estado = $3::text)`;
    const params = [desde, hasta, estado];

    try {
      const [resumen, porMes, porMetodo, lista] = await Promise.all([
        pool.query(
          `SELECT f.estado,
                  COUNT(*) AS cantidad,
                  COALESCE(SUM(f.total), 0) AS total,
                  COALESCE(SUM(f.peso_facturado_lb), 0) AS libras
           FROM facturas f ${filtro}
           GROUP BY f.estado`,
          params
        ),
        pool.query(
          `SELECT to_char(${dia}, 'YYYY-MM') AS mes,
                  COUNT(*) AS cantidad,
                  COALESCE(SUM(f.total), 0) AS total,
                  COALESCE(SUM(f.peso_facturado_lb), 0) AS libras
           FROM facturas f ${filtro} AND f.estado <> 'anulada'
           GROUP BY 1
           ORDER BY 1 ASC`,
          params
        ),
        pool.query(
          `SELECT COALESCE(f.metodo_pago, 'sin dato') AS metodo,
                  COUNT(*) AS cantidad,
                  COALESCE(SUM(f.total), 0) AS total
           FROM facturas f ${filtro} AND f.estado = 'pagada'
           GROUP BY 1
           ORDER BY total DESC`,
          params
        ),
        pool.query(
          `SELECT f.id, f.numero_factura, ${dia} AS fecha,
                  TRIM(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellido, '')) AS cliente,
                  f.peso_facturado_lb, f.precio_libra, f.costo_envio, f.cargo_manejo,
                  f.seguro, f.descuento_referido, f.total, f.estado, f.metodo_pago
           FROM facturas f
           LEFT JOIN usuarios u ON u.id = f.usuario_id
           ${filtro}
           ORDER BY f.fecha_creacion DESC, f.id DESC`,
          params
        ),
      ]);

      const porEstado = { pagada: { cantidad: 0, total: 0, libras: 0 },
                          pendiente: { cantidad: 0, total: 0, libras: 0 },
                          anulada: { cantidad: 0, total: 0, libras: 0 } };
      for (const r of resumen.rows) {
        porEstado[r.estado] = {
          cantidad: Number(r.cantidad), total: Number(r.total), libras: Number(r.libras),
        };
      }
      // "Facturado" = pagadas + pendientes (las anuladas no cuentan).
      const facturado = {
        cantidad: porEstado.pagada.cantidad + porEstado.pendiente.cantidad,
        total: porEstado.pagada.total + porEstado.pendiente.total,
        libras: porEstado.pagada.libras + porEstado.pendiente.libras,
      };

      return res.json({
        rango: { desde, hasta, estado },
        facturado,
        por_estado: porEstado,
        por_mes: porMes.rows,
        por_metodo: porMetodo.rows,
        facturas: lista.rows,
      });
    } catch (error) {
      console.error('Error en GET /admin/reportes/facturacion:', error);
      return res.status(500).json({ mensaje: 'Error interno al generar el reporte de facturación' });
    }
  }
);

module.exports = router;
