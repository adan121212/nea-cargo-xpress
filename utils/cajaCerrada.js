// Revisa si la caja de HOY (hora de Panamá) ya fue cerrada.
// Se usa antes de cualquier cobro: si la caja ya cerró, ese dinero
// quedaría fuera del cierre del día y la caja no cuadraría.
const { fechaPanama } = require('./fechas');

async function cajaCerradaHoy(db) {
  const hoy = fechaPanama();
  const r = await db.query('SELECT id FROM cierres_caja WHERE fecha = $1', [hoy]);
  return r.rows.length > 0 ? hoy : null;
}

function respuestaCajaCerrada(res, fecha) {
  return res.status(409).json({
    mensaje: `La caja del ${fecha} ya fue cerrada. No se pueden registrar más cobros hoy.`,
    caja_cerrada: true,
  });
}

module.exports = { cajaCerradaHoy, respuestaCajaCerrada };
