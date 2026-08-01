const jwt = require('jsonwebtoken');

/**
 * Protege rutas: exige un header Authorization: Bearer <token>.
 * Si es valido, agrega req.usuario = { id, email, numero_casillero }.
 */
function requiereAutenticacion(req, res, next) {
  const header = req.headers.authorization || '';
  const [tipo, token] = header.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ mensaje: 'No autenticado. Envía tu token en el header Authorization.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (error) {
    return res.status(401).json({ mensaje: 'Token inválido o expirado. Vuelve a iniciar sesión.' });
  }
}

module.exports = { requiereAutenticacion };
