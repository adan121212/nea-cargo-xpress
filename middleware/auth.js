const jwt = require('jsonwebtoken');
const pool = require('../db');

/**
 * Protege rutas: exige un header Authorization: Bearer <token>.
 * Si es valido, agrega req.usuario = { id, email, numero_casillero, rol }.
 *
 * Ademas de verificar la firma, confirma contra la base de datos que el
 * token no fue emitido ANTES del ultimo cambio de contraseña del usuario.
 * Asi, si alguien roba un token y el dueño cambia su contraseña, el token
 * robado deja de funcionar de inmediato en vez de seguir valido hasta que
 * expire por su cuenta (hasta 7 dias).
 *
 * El "rol" SIEMPRE se toma fresco de la base de datos (no del payload del
 * token). Asi, si a un admin le quitas el rol, pierde el acceso de admin
 * en la siguiente peticion, sin esperar a que su token expire.
 */
async function requiereAutenticacion(req, res, next) {
  const header = req.headers.authorization || '';
  const [tipo, token] = header.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ mensaje: 'No autenticado. Envía tu token en el header Authorization.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const resultado = await pool.query(
      'SELECT token_valido_desde, rol FROM usuarios WHERE id = $1',
      [payload.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({ mensaje: 'Token inválido o expirado. Vuelve a iniciar sesión.' });
    }

    const { token_valido_desde: tokenValidoDesde, rol: rolActual } = resultado.rows[0];
    const tokenEmitidoEn = new Date(payload.iat * 1000); // jwt.iat viene en segundos

    if (tokenEmitidoEn < tokenValidoDesde) {
      return res.status(401).json({
        mensaje: 'Tu sesión ya no es válida (la contraseña cambió). Vuelve a iniciar sesión.',
      });
    }

    req.usuario = { ...payload, rol: rolActual };
    next();
  } catch (error) {
    return res.status(401).json({ mensaje: 'Token inválido o expirado. Vuelve a iniciar sesión.' });
  }
}

module.exports = { requiereAutenticacion };
