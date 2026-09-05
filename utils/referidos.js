// Lógica del sistema de referidos.
//
// Reglas de negocio (confirmadas por el usuario, 2026-09-05):
// - El código de referido de cada cliente es su propio número de casillero.
// - Solo se premia a QUIEN REFIERE, nunca al nuevo cliente.
// - El crédito se activa cuando el referido paga su PRIMERA factura (no al registrarse).
// - Se paga UNA sola vez por referido, sin importar cuántos envíos haga después.
// - No se puede "referir" a un cliente que ya existía en el sistema — el código
//   solo se toma en cuenta durante el registro de una cuenta nueva.

const MONTO_CREDITO_REFERIDO = 5.00;

// Se llama durante el registro de un cliente NUEVO, dentro de la misma transacción.
// `codigoReferido` es lo que el nuevo cliente escribió (se espera el numero_casillero
// de quien lo refirió). Si el código no existe, está vacío, o es su propio código
// (imposible en registro, pero por seguridad), simplemente no hace nada — nunca
// rompe el registro del cliente nuevo.
async function registrarReferido(client, codigoReferido, referidoId) {
  const codigo = (codigoReferido || '').trim().toUpperCase();
  if (!codigo) return;
  try {
    const referidor = await client.query(
      'SELECT id FROM usuarios WHERE numero_casillero = $1',
      [codigo]
    );
    if (referidor.rows.length === 0) return;
    const referidorId = referidor.rows[0].id;
    if (referidorId === referidoId) return;
    await client.query(
      `INSERT INTO referidos (referidor_id, referido_id, monto_credito)
       VALUES ($1, $2, $3)
       ON CONFLICT (referido_id) DO NOTHING`,
      [referidorId, referidoId, MONTO_CREDITO_REFERIDO]
    );
  } catch (error) {
    console.error('Error registrando referido:', error);
  }
}

// Se llama justo después de que una factura queda 'pagada' (en la misma
// transacción o con el pool, no importa). Si es el PRIMER pago de este
// cliente y tiene un referido pendiente, activa el crédito a favor de
// quien lo refirió. Si no se cumple alguna condición, no hace nada.
async function activarCreditoSiCorresponde(db, usuarioId) {
  try {
    const pagos = await db.query(
      `SELECT COUNT(*)::int AS n FROM facturas WHERE usuario_id = $1 AND estado = 'pagada'`,
      [usuarioId]
    );
    if (pagos.rows[0].n !== 1) return; // no es su primer pago

    const referido = await db.query(
      `SELECT id, referidor_id, monto_credito FROM referidos WHERE referido_id = $1 AND estado = 'pendiente'`,
      [usuarioId]
    );
    if (referido.rows.length === 0) return;

    const { id, referidor_id, monto_credito } = referido.rows[0];
    await db.query(
      `UPDATE referidos SET estado = 'activado', fecha_activacion = NOW() WHERE id = $1`,
      [id]
    );
    await db.query(
      `UPDATE usuarios SET saldo_a_favor = saldo_a_favor + $1 WHERE id = $2`,
      [monto_credito, referidor_id]
    );
  } catch (error) {
    console.error('Error activando crédito de referido:', error);
  }
}

// Al crear una factura, aplica lo que se pueda del saldo a favor del cliente
// (sin dejar el total en negativo) y descuenta ese monto de su saldo.
// Devuelve el descuento aplicado (0 si no tenía saldo).
async function aplicarSaldoAFavor(db, usuarioId, total) {
  const usuarioRes = await db.query('SELECT saldo_a_favor FROM usuarios WHERE id = $1', [usuarioId]);
  const saldo = Number(usuarioRes.rows[0]?.saldo_a_favor || 0);
  const descuento = Math.min(saldo, Number(total));
  if (descuento > 0) {
    await db.query(
      'UPDATE usuarios SET saldo_a_favor = saldo_a_favor - $1 WHERE id = $2',
      [descuento.toFixed(2), usuarioId]
    );
  }
  return descuento;
}

module.exports = {
  MONTO_CREDITO_REFERIDO,
  registrarReferido,
  activarCreditoSiCorresponde,
  aplicarSaldoAFavor,
};
