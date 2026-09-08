/**
 * Debe usarse DESPUÉS de requiereAutenticacion (necesita req.usuario ya con rol).
 * Bloquea el acceso si el usuario autenticado no trabaja aquí (ni admin ni trabajador).
 * Para restringir una pantalla específica solo a quien tenga permiso, usar
 * además requierePermiso('clave') de middleware/permiso.js.
 */
function requiereAdmin(req, res, next) {
  if (!req.usuario || (req.usuario.rol !== 'admin' && req.usuario.rol !== 'trabajador')) {
    return res.status(403).json({ mensaje: 'No tienes permisos de administrador para esta acción.' });
  }
  next();
}

module.exports = { requiereAdmin };
