/**
 * Debe usarse DESPUÉS de requiereAutenticacion (necesita req.usuario ya con rol).
 * Bloquea el acceso si el usuario autenticado no es 'admin'.
 */
function requiereAdmin(req, res, next) {
  if (!req.usuario || req.usuario.rol !== 'admin') {
    return res.status(403).json({ mensaje: 'No tienes permisos de administrador para esta acción.' });
  }
  next();
}

module.exports = { requiereAdmin };
