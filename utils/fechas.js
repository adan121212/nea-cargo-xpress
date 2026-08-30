/**
 * Fechas en hora de Panamá.
 *
 * Por qué existe este archivo:
 * el servidor de Render y la base en Neon trabajan en UTC. Panamá va
 * 5 horas atrás, así que después de las 7:00 PM local el UTC ya cambió
 * de día. Cualquier cosa que use new Date().toISOString() para saber
 * "qué día es hoy" va a contar mal las noches.
 *
 * Ese error apareció ya en tres archivos distintos (caja, facturas y
 * reportes) porque cada uno resolvía las fechas por su cuenta. Todo lo
 * que tenga que ver con días debe usar estas funciones.
 */

const ZONA = 'America/Panama';

/** Fecha de hoy en Panamá, en formato YYYY-MM-DD. */
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

/** Primer día del mes actual en Panamá (YYYY-MM-01). */
function inicioMes() {
  return fechaPanama().slice(0, 8) + '01';
}

/** Resta días a un YYYY-MM-DD sin que se meta la zona horaria del servidor. */
function restarDias(fechaISO, dias) {
  const [a, m, d] = String(fechaISO).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  t.setUTCDate(t.getUTCDate() - dias);
  return t.toISOString().slice(0, 10);
}

/** "19 de agosto de 2026" a partir de un YYYY-MM-DD, sin depender de zonas. */
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];
function fechaLarga(fechaISO) {
  const [anio, mes, dia] = String(fechaISO).slice(0, 10).split('-');
  return `${Number(dia)} de ${MESES[Number(mes) - 1]} de ${anio}`;
}

/**
 * Trozo de SQL que convierte una columna timestamp (guardada en UTC)
 * a la fecha del día en Panamá. Se usa así:
 *
 *   WHERE ${diaPanama('fecha_pago')} = $1::date
 *
 * Solo se le pasan nombres de columna escritos en el código, nunca
 * datos que vengan del usuario.
 */
function diaPanama(columna) {
  return `(${columna} AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date`;
}

module.exports = { ZONA, fechaPanama, horaPanama, inicioMes, restarDias, fechaLarga, diaPanama };
