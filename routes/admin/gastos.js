const express = require('express');
const multer = require('multer');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { subirFotoPaquete, eliminarFotoCloudinary } = require('../../utils/cloudinary');
const { ZONA, fechaPanama, inicioMes } = require('../../utils/fechas');
const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('El comprobante debe ser una imagen'));
    cb(null, true);
  },
});

// Categorías pensadas para un courier. Si hace falta otra, se agrega aquí.
const CATEGORIAS = {
  flete_internacional: 'Flete internacional',
  bodega: 'Bodega y alquiler',
  salarios: 'Salarios y personal',
  transporte_local: 'Transporte local',
  suministros: 'Suministros y empaque',
  tecnologia: 'Tecnología y sistema',
  publicidad: 'Publicidad',
  bancarios: 'Gastos bancarios',
  impuestos: 'Impuestos y trámites',
  mantenimiento: 'Mantenimiento',
  otros: 'Otros',
};
const METODOS = ['efectivo', 'tarjeta', 'transferencia', 'yappy'];



const SELECT_BASE = `
  SELECT g.*, u.nombre AS registrado_por_nombre
  FROM gastos g
  LEFT JOIN usuarios u ON u.id = g.registrado_por`;

// --- GET /api/admin/gastos/categorias ---
router.get('/categorias', (req, res) => res.json({ categorias: CATEGORIAS }));

// --- GET /api/admin/gastos ---
router.get(
  '/',
  [
    query('desde').optional().isISO8601(),
    query('hasta').optional().isISO8601(),
    query('categoria').optional().trim(),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const desde = req.query.desde || inicioMes();
    const hasta = req.query.hasta || fechaPanama();
    const valores = [desde, hasta];
    let extra = '';
    if (req.query.categoria) {
      valores.push(req.query.categoria);
      extra = ` AND g.categoria = $${valores.length}`;
    }
    try {
      const r = await pool.query(
        `${SELECT_BASE} WHERE g.fecha BETWEEN $1::date AND $2::date${extra}
         ORDER BY g.fecha DESC, g.id DESC LIMIT 300`, valores
      );
      return res.json({ gastos: r.rows, desde, hasta, categorias: CATEGORIAS });
    } catch (error) {
      console.error('Error en GET /admin/gastos:', error);
      return res.status(500).json({ mensaje: 'Error interno al listar los gastos' });
    }
  }
);

// --- GET /api/admin/gastos/resumen ---
// Lo cobrado, lo gastado y la ganancia del período.
router.get(
  '/resumen',
  [query('desde').optional().isISO8601(), query('hasta').optional().isISO8601()],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const desde = req.query.desde || inicioMes();
    const hasta = req.query.hasta || fechaPanama();
    try {
      // Ingresos: fletes cobrados + comisiones de compras cobradas
      const fletes = await pool.query(
        `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*)::int AS cantidad
         FROM facturas
         WHERE estado = 'pagada' AND fecha_pago IS NOT NULL
           AND (fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date BETWEEN $1::date AND $2::date`,
        [desde, hasta]
      );

      let comisiones = { total: 0, cantidad: 0 };
      try {
        const c = await pool.query(
          `SELECT COALESCE(SUM(comision), 0) AS total, COUNT(*)::int AS cantidad
           FROM compras
           WHERE estado = 'pagada' AND fecha_pago IS NOT NULL
             AND (fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date BETWEEN $1::date AND $2::date`,
          [desde, hasta]
        );
        comisiones = { total: Number(c.rows[0].total), cantidad: c.rows[0].cantidad };
      } catch (e) {
        // La tabla compras puede no existir todavía; no es motivo para fallar
      }

      const porCategoria = await pool.query(
        `SELECT categoria, COALESCE(SUM(monto), 0) AS total, COUNT(*)::int AS cantidad
         FROM gastos WHERE fecha BETWEEN $1::date AND $2::date
         GROUP BY categoria ORDER BY 2 DESC`,
        [desde, hasta]
      );

      const porDia = await pool.query(
        `SELECT fecha, COALESCE(SUM(monto), 0) AS total
         FROM gastos WHERE fecha BETWEEN $1::date AND $2::date
         GROUP BY fecha ORDER BY fecha ASC`,
        [desde, hasta]
      );

      const recurrentes = await pool.query(
        `SELECT COALESCE(SUM(monto), 0) AS total
         FROM gastos WHERE fecha BETWEEN $1::date AND $2::date AND es_recurrente = TRUE`,
        [desde, hasta]
      );

      const ingresoFletes = Number(fletes.rows[0].total);
      const totalIngresos = ingresoFletes + comisiones.total;
      const totalGastos = porCategoria.rows.reduce((a, r) => a + Number(r.total), 0);
      const utilidad = totalIngresos - totalGastos;

      return res.json({
        desde, hasta,
        ingresos: {
          fletes: ingresoFletes,
          comisiones_compras: comisiones.total,
          total: totalIngresos,
          facturas: fletes.rows[0].cantidad,
          compras: comisiones.cantidad,
        },
        gastos: {
          total: totalGastos,
          recurrentes: Number(recurrentes.rows[0].total),
          por_categoria: porCategoria.rows.map(r => ({
            categoria: r.categoria,
            etiqueta: CATEGORIAS[r.categoria] || r.categoria,
            total: Number(r.total),
            cantidad: r.cantidad,
          })),
          por_dia: porDia.rows.map(r => ({ fecha: r.fecha, total: Number(r.total) })),
        },
        utilidad,
        margen: totalIngresos > 0 ? (utilidad / totalIngresos) * 100 : 0,
      });
    } catch (error) {
      console.error('Error en GET /admin/gastos/resumen:', error);
      return res.status(500).json({ mensaje: 'Error interno al calcular el resumen' });
    }
  }
);

// --- GET /api/admin/gastos/salidas-caja?fecha= ---
// Efectivo que salió de la gaveta ese día, para cuadrar el cierre.
router.get('/salidas-caja', [query('fecha').isISO8601()], async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
  try {
    const r = await pool.query(
      `SELECT id, categoria, descripcion, monto FROM gastos
       WHERE fecha = $1::date AND sale_de_caja = TRUE ORDER BY id ASC`,
      [req.query.fecha]
    );
    const total = r.rows.reduce((a, g) => a + Number(g.monto), 0);
    return res.json({ salidas: r.rows, total });
  } catch (error) {
    console.error('Error en GET /admin/gastos/salidas-caja:', error);
    return res.status(500).json({ mensaje: 'Error interno al calcular las salidas de caja' });
  }
});

// --- POST /api/admin/gastos ---
router.post(
  '/',
  upload.single('comprobante'),
  [
    body('fecha').isISO8601().withMessage('Fecha inválida'),
    body('categoria').custom(v => Object.keys(CATEGORIAS).includes(v)).withMessage('Categoría inválida'),
    body('descripcion').trim().notEmpty().withMessage('Describe el gasto'),
    body('monto').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor que cero'),
    body('metodo_pago').optional({ checkFalsy: true }).isIn(METODOS),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const b = req.body;
    const bool = v => v === true || v === 'true' || v === '1';
    try {
      let comprobante = { url: null, public_id: null };
      if (req.file) {
        try {
          comprobante = await subirFotoPaquete(req.file.buffer, req.file.mimetype, `gastos/${b.fecha}`);
        } catch (e) {
          console.error('Error subiendo comprobante:', e);
        }
      }
      const r = await pool.query(
        `INSERT INTO gastos (fecha, categoria, descripcion, monto, proveedor, numero_documento,
                             metodo_pago, sale_de_caja, es_recurrente,
                             comprobante_url, comprobante_id, notas, registrado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [b.fecha, b.categoria, b.descripcion.trim(), Number(b.monto).toFixed(2),
         b.proveedor || null, b.numero_documento || null, b.metodo_pago || null,
         bool(b.sale_de_caja), bool(b.es_recurrente),
         comprobante.url, comprobante.public_id, b.notas || null, req.usuario.id]
      );
      const completo = await pool.query(`${SELECT_BASE} WHERE g.id = $1`, [r.rows[0].id]);
      return res.status(201).json({ mensaje: 'Gasto registrado', gasto: completo.rows[0] });
    } catch (error) {
      console.error('Error en POST /admin/gastos:', error);
      return res.status(500).json({ mensaje: 'Error interno al registrar el gasto' });
    }
  }
);

// --- DELETE /api/admin/gastos/:id ---
router.delete('/:id', async (req, res) => {
  try {
    const g = await pool.query('SELECT comprobante_id FROM gastos WHERE id = $1', [req.params.id]);
    if (g.rows.length === 0) return res.status(404).json({ mensaje: 'Gasto no encontrado' });
    if (g.rows[0].comprobante_id) {
      try { await eliminarFotoCloudinary(g.rows[0].comprobante_id); } catch (e) {}
    }
    await pool.query('DELETE FROM gastos WHERE id = $1', [req.params.id]);
    return res.json({ mensaje: 'Gasto eliminado' });
  } catch (error) {
    console.error('Error en DELETE /admin/gastos/:id:', error);
    return res.status(500).json({ mensaje: 'Error interno al eliminar el gasto' });
  }
});

module.exports = router;
