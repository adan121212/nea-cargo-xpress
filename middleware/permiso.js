/**
 * Restringe una pantalla/módulo específico a quien tenga permiso.
 * Un admin siempre pasa. Un trabajador solo pasa si 'clave' está en su
 * lista de permisos_admin (guardada en la base de datos, leída fresca en
 * cada request por requiereAutenticacion).
 *
 * Usa el código 423 (no 401/403) para que el frontend NO cierre la sesión:
 * en este proyecto 401/403 significan "sesión inválida" y el cliente
 * borra el token automáticamente al recibirlos. 423 significa "sesión
 * válida, pero sin permiso para esta pantalla en particular".
 */
function requierePermiso(clave) {
  return function (req, res, next) {
    if (!req.usuario) {
      return res.status(401).json({ mensaje: 'No autenticado.' });
    }
    if (req.usuario.rol === 'admin') return next();
    if (req.usuario.rol === 'trabajador' && Array.isArray(req.usuario.permisos) && req.usuario.permisos.includes(clave)) {
      return next();
    }
    return res.status(423).json({ mensaje: 'No tienes permiso para acceder a esta pantalla.' });
  };
}

/**
 * Para acciones que SOLO el administrador puede hacer, nunca delegables
 * a un trabajador aunque tenga permisos (ej. crear trabajadores, cambiar
 * sus permisos). Usar en vez de requierePermiso cuando la acción es
 * sensible de por sí.
 */
function requiereSoloAdmin(req, res, next) {
  if (!req.usuario || req.usuario.rol !== 'admin') {
    return res.status(403).json({ mensaje: 'Solo el administrador puede hacer esto.' });
  }
  next();
}

module.exports = { requierePermiso, requiereSoloAdmin };
