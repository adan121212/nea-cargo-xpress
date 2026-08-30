const express = require('express');
const pool = require('../db');
const { enviarCorreoGenerico } = require('../utils/mailer');
const { fechaPanama } = require('../utils/fechas');
const router = express.Router();


/**
 * Todas las rutas de aquí las llama un servicio externo, no una persona.
 * Se protegen con un token secreto que viaja en la URL o en la cabecera.
 * Si el token no coincide devolvemos 404 para no revelar que existen.
 */
router.use((req, res, next) => {
  if (!process.env.CRON_SECRET) {
    return res.status(503).json({ mensaje: 'Las tareas programadas no están configuradas.' });
  }
  const token = req.query.token || req.get('x-cron-token');
  if (token !== process.env.CRON_SECRET) {
    return res.status(404).json({ mensaje: 'No encontrado' });
  }
  next();
});

// --- GET /api/cron/caja-sin-cerrar ---
// Se llama una vez al día (8:00 PM hora de Panamá).
// Si hubo cobros hoy y la caja sigue abierta, avisa por correo.
router.get('/caja-sin-cerrar', async (req, res) => {
  const hoy = fechaPanama();
  try {
    const cierre = await pool.query('SELECT id FROM cierres_caja WHERE fecha = $1', [hoy]);
    if (cierre.rows.length > 0) {
      return res.json({ fecha: hoy, accion: 'ninguna', motivo: 'La caja ya está cerrada.' });
    }

    // Cobros de hoy, contados en hora de Panamá
    const cobros = await pool.query(
      `SELECT COUNT(*)::int AS cantidad, COALESCE(SUM(total), 0) AS total
       FROM facturas
       WHERE estado = 'pagada'
         AND fecha_pago IS NOT NULL
         AND (fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Panama')::date = $1::date`,
      [hoy]
    );
    const { cantidad, total } = cobros.rows[0];

    if (cantidad === 0) {
      return res.json({ fecha: hoy, accion: 'ninguna', motivo: 'No hubo cobros hoy.' });
    }

    const porMetodo = await pool.query(
      `SELECT COALESCE(metodo_pago, 'sin método') AS metodo,
              COUNT(*)::int AS cantidad,
              COALESCE(SUM(total), 0) AS total
       FROM facturas
       WHERE estado = 'pagada'
         AND fecha_pago IS NOT NULL
         AND (fecha_pago AT TIME ZONE 'UTC' AT TIME ZONE 'America/Panama')::date = $1::date
       GROUP BY 1 ORDER BY 3 DESC`,
      [hoy]
    );

    const correoAdmin = process.env.ADMIN_NOTIFICACION_EMAIL;
    if (!correoAdmin) {
      return res.status(503).json({ mensaje: 'ADMIN_NOTIFICACION_EMAIL no está configurado.' });
    }

    const [anio, mes, dia] = hoy.split('-');
    const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const fechaBonita = `${Number(dia)} de ${MESES[Number(mes) - 1]} de ${anio}`;

    const filas = porMetodo.rows.map(m => `
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #eceef0;color:#374151;text-transform:capitalize;">${m.metodo}</td>
        <td style="padding:9px 0;border-bottom:1px solid #eceef0;color:#6b7280;text-align:center;">${m.cantidad}</td>
        <td style="padding:9px 0;border-bottom:1px solid #eceef0;color:#0c1b33;text-align:right;font-weight:bold;">$${Number(m.total).toFixed(2)}</td>
      </tr>`).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;">
        <h2 style="color:#0c1b33;margin:0 0 6px;">La caja de hoy sigue abierta</h2>
        <p style="color:#6b7280;margin:0 0 20px;">${fechaBonita}</p>

        <div style="background:#fff7ed;border-left:4px solid #ff6a1a;border-radius:8px;padding:16px 18px;margin-bottom:20px;">
          <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Cobrado hoy</p>
          <p style="margin:0;font-size:28px;font-weight:bold;color:#ff6a1a;">$${Number(total).toFixed(2)}</p>
          <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">${cantidad} factura${cantidad === 1 ? '' : 's'}</p>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:22px;">
          <tr>
            <th style="text-align:left;padding-bottom:8px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">Método</th>
            <th style="text-align:center;padding-bottom:8px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">Cant.</th>
            <th style="text-align:right;padding-bottom:8px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;">Total</th>
          </tr>
          ${filas}
        </table>

        <p style="text-align:center;margin:0 0 20px;">
          <a href="${process.env.BASE_URL || 'https://www.neacargoxpress.com'}/admin.html"
             style="background:#ff6a1a;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">
            Cerrar la caja
          </a>
        </p>

        <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0;">
          Si cierras la caja mañana, el cierre se registra con la fecha de mañana y el corte de hoy queda incompleto.
        </p>
      </div>`;

    await enviarCorreoGenerico(correoAdmin, `Caja sin cerrar — $${Number(total).toFixed(2)} cobrados hoy`, html);

    return res.json({
      fecha: hoy,
      accion: 'correo_enviado',
      para: correoAdmin,
      cantidad,
      total: Number(total).toFixed(2),
    });
  } catch (error) {
    console.error('Error en /cron/caja-sin-cerrar:', error);
    return res.status(500).json({ mensaje: 'Error interno en la tarea programada' });
  }
});

// --- GET /api/cron/ping ---
// Para probar que el token y la conexión funcionan.
router.get('/ping', (req, res) => {
  return res.json({ ok: true, fecha_panama: fechaPanama(), hora_servidor: new Date().toISOString() });
});

module.exports = router;
module.exports.fechaPanama = fechaPanama;
