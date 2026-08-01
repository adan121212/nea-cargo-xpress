# Sistema de Logística — Módulo Cliente

Módulo cliente de un sistema tipo "casillero" (courier / package forwarding), similar en concepto a
ShopLine Panamá: el cliente crea una cuenta, recibe un número de casillero con una dirección en Miami,
y "prealerta" cada paquete que compra para que la empresa lo identifique al llegar a la bodega.

Construido con **Node.js + Express + PostgreSQL + JWT + Nodemailer**.

## ¿Qué incluye este módulo?

- **Registro de cliente** → crea la cuenta y le asigna automáticamente un número de casillero (ej. `PN-00042`).
- **Confirmación por correo** → como en el sistema anterior, se envía un enlace de verificación.
- **Login con JWT** → solo permite iniciar sesión si la cuenta ya fue verificada.
- **Perfil de casillero** → devuelve los datos del cliente y la dirección de la bodega en Miami que debe usar al comprar.
- **Prealerta de paquetes** → el cliente registra tienda, número de tracking, descripción y valor declarado de cada compra, antes de que llegue a la bodega.
- **Listado y detalle de paquetes** → cada cliente ve únicamente sus propios paquetes.

### Lo que queda para las siguientes fases (no incluido aún)
- Rastreo público de paquetes (sin login) por número de tracking.
- Calculadora de tarifas de envío.
- Frontend del panel administrativo (ya está el frontend del cliente en `public/index.html`).

Dilo cuando quieras seguir con alguna de estas partes.

## Panel administrativo (nuevo)

Se agregó un **rol** a los usuarios (`cliente` o `admin`). Los usuarios `admin` pueden:

- Ver y filtrar **todos** los paquetes de todos los clientes.
- Actualizar el estado de cualquier paquete (`en_bodega_miami`, `en_transito`, `en_panama`, `listo_para_retiro`, `entregado`).
- Ver la lista de todos los clientes registrados, con su total de paquetes.
- Ver el detalle de un cliente específico y todos sus paquetes.
- Gestionar sucursales (crear, editar, eliminar).

### Cómo convertir un usuario en administrador

No hay una pantalla para esto (por seguridad, un admin no se crea desde un formulario público). Regístrate normalmente como cliente y luego, directo en la base de datos, ejecuta:

```sql
UPDATE usuarios SET rol = 'admin' WHERE email = 'tu_correo@ejemplo.com';
```

Si ya tenías la base de datos creada de antes (por ejemplo, ya desplegada), primero corre `sql/migracion_admin.sql` para agregar la columna `rol` y la tabla `sucursales`.

### Endpoints de administración

Todos requieren `Authorization: Bearer <token>` de un usuario con `rol = 'admin'`.

```
GET   /api/admin/paquetes                 # todos los paquetes (filtros: ?estado=&email=&tracking=)
PATCH /api/admin/paquetes/:id/estado      # body: { "estado": "en_transito" }

GET   /api/admin/usuarios                 # todos los clientes
GET   /api/admin/usuarios/:id             # detalle de un cliente + sus paquetes

GET   /api/admin/sucursales
POST  /api/admin/sucursales               # body: { nombre, direccion, telefono, horario }
PUT   /api/admin/sucursales/:id
DELETE /api/admin/sucursales/:id
```

Y una pública, sin login, para que cualquiera vea las sucursales activas:
```
GET /api/sucursales
```

### Ejemplo con curl

```bash
# Actualizar el estado de un paquete
curl -X PATCH http://localhost:3000/api/admin/paquetes/1/estado \
  -H "Authorization: Bearer TOKEN_DE_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"estado":"en_bodega_miami"}'

# Ver todos los paquetes en tránsito
curl "http://localhost:3000/api/admin/paquetes?estado=en_transito" \
  -H "Authorization: Bearer TOKEN_DE_ADMIN"

# Crear una sucursal
curl -X POST http://localhost:3000/api/admin/sucursales \
  -H "Authorization: Bearer TOKEN_DE_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Sucursal Colón Centro","direccion":"Calle 9, Avenida Bolívar","telefono":"6318-5982","horario":"Lun-Vie 10am-6pm"}'
```


## 1. Instalación

```bash
npm install
```

## 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Completa especialmente:
- `DB_*`: conexión a PostgreSQL.
- `JWT_SECRET`: una cadena larga y aleatoria (ej. `openssl rand -hex 32`).
- `WAREHOUSE_*`: la dirección real de tu bodega en Miami.
- `SMTP_*`: credenciales de correo para el envío de confirmación.

## 3. Crear la base de datos y las tablas

```bash
createdb sistema_logistica
psql -d sistema_logistica -f sql/schema.sql
```

## 4. Ejecutar

```bash
npm start
# o con recarga automática:
npm run dev
```

## 5. Endpoints

### Registro
```
POST /api/auth/registro
{
  "nombre": "Ana",
  "apellido": "Pérez",
  "email": "ana@ejemplo.com",
  "telefono": "6123-4567",
  "password": "MiPassword123"
}
```
Crea la cuenta, asigna el número de casillero y envía el correo de confirmación.

### Verificar cuenta
```
GET /api/auth/verificar/:token
```

### Login
```
POST /api/auth/login
{ "email": "ana@ejemplo.com", "password": "MiPassword123" }
```
Responde con `token` (JWT). Úsalo en el header `Authorization: Bearer <token>` para los endpoints protegidos.

### Perfil y dirección de casillero (protegido)
```
GET /api/casillero/perfil
Authorization: Bearer <token>
```
Devuelve los datos del cliente y la dirección exacta (con su número de casillero como "Suite") que debe usar al comprar en tiendas de EE.UU.

### Prealertar un paquete (protegido)
```
POST /api/paquetes/prealertar
Authorization: Bearer <token>
{
  "tienda": "Amazon",
  "numero_tracking": "1Z999AA10123456784",
  "descripcion": "Audífonos inalámbricos",
  "valor_declarado": 45.99,
  "peso_lb": 1.2
}
```

### Listar mis paquetes (protegido)
```
GET /api/paquetes
Authorization: Bearer <token>
```

### Detalle de un paquete (protegido)
```
GET /api/paquetes/:id
Authorization: Bearer <token>
```

## 6. Probar el flujo completo con curl

```bash
# 1. Registro
curl -X POST http://localhost:3000/api/auth/registro \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Ana","apellido":"Pérez","email":"ana@ejemplo.com","password":"MiPassword123"}'

# 2. Verifica la cuenta abriendo el enlace que llega al correo

# 3. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@ejemplo.com","password":"MiPassword123"}'
# copia el "token" de la respuesta

# 4. Ver mi casillero
curl http://localhost:3000/api/casillero/perfil \
  -H "Authorization: Bearer TU_TOKEN_AQUI"

# 5. Prealertar un paquete
curl -X POST http://localhost:3000/api/paquetes/prealertar \
  -H "Authorization: Bearer TU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{"tienda":"Amazon","numero_tracking":"1Z999AA10123456784","valor_declarado":45.99}'
```

## 7. Notas de seguridad

- Contraseñas hasheadas con `bcrypt`.
- Sesiones con JWT firmado (`JWT_SECRET`), expiran según `JWT_EXPIRES_IN`.
- Cada endpoint de paquetes filtra por `usuario_id`, así que un cliente nunca puede ver paquetes de otro.
- Recuerda no subir tu archivo `.env` real a ningún repositorio.
