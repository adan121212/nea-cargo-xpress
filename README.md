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
- Producción real: dominio propio en Resend + número de WhatsApp Business verificado + PagueloFacil en modo producción (requiere aprobación KYC de PagueloFacil).

Dilo cuando quieras seguir con alguna de estas partes.

## Mostrador (nuevo)

Pestaña **Mostrador** (la primera que ves al entrar al panel admin) — para cuando el cliente llega en persona a buscar su paquete:

1. Busca al cliente por número de casillero, nombre, correo, o el tracking de un paquete.
2. Ves todos sus **paquetes pendientes de entrega**, con el estado de su factura (si tiene una), y también cualquier **factura pendiente suelta** (de un paquete que ya se entregó antes pero quedó sin cobrar).
3. Si la factura está pendiente: eliges el método de pago (efectivo, tarjeta física, transferencia) y el botón **"Cobrar y entregar"** marca la factura como pagada Y el paquete como entregado, en un solo paso.
4. Para una factura pendiente suelta (sin entrega asociada): botón **"Cobrar"**, marca la factura pagada sin tocar ningún paquete.
5. Si no hay factura pendiente en un paquete: solo confirmas la entrega.

### Métodos de pago registrados
- `efectivo`, `tarjeta`, `transferencia` — los marca el staff manualmente desde el Mostrador.
- `pagueloFacil` — se registra automáticamente cuando el cliente paga con tarjeta en línea desde su dashboard.

### Endpoints
```
GET  /api/admin/mostrador/buscar?q=PN-00042      # busca por casillero, nombre, correo o tracking
POST /api/admin/mostrador/entregar                # { paquete_id, factura_id?, metodo_pago? }
POST /api/admin/mostrador/cobrar                  # { factura_id, metodo_pago } - factura suelta, sin entrega
```

## Reportes (nuevo)

Pestaña **Reportes** en el panel admin, con rango de fechas ajustable (por defecto, últimos 30 días):

- Ingresos totales (facturas pagadas) y monto pendiente por cobrar.
- Paquetes y clientes nuevos en el rango.
- Gráfico de barras de ingresos por día.
- Paquetes agrupados por estado.
- Top 5 clientes por cantidad de paquetes.
- Exportar a CSV los ingresos por día.

### Endpoint
```
GET /api/admin/reportes?desde=2026-01-01&hasta=2026-01-31
```

## Pago con tarjeta (nuevo)

Se integró **PagueloFacil** (pasarela panameña) mediante su "Enlace de Pago": el cliente hace clic en "Pagar con tarjeta" en una factura pendiente, sale a la página segura de PagueloFacil, paga, y vuelve automáticamente a su dashboard con la factura ya marcada como pagada. **Nunca manejamos números de tarjeta en nuestro servidor.**

> Stripe no está disponible para negocios registrados en Panamá, por eso se usó PagueloFacil.

### Configurar PagueloFacil

1. Para pruebas: regístrate en el ambiente sandbox — https://demo.paguelofacil.com
2. Para producción real: crea cuenta en https://paguelofacil.com (requiere cuenta bancaria panameña y validación KYC de tu negocio).
3. En tu cuenta, busca tu **CCLW** (código web / llave de conexión).
4. Variables de entorno:
   - `PAGUELOFACIL_CCLW`: tu código web.
   - `PAGUELOFACIL_ENV`: `production` para cobros reales, cualquier otro valor usa el sandbox de pruebas.
5. **Opcional pero recomendado**: escribe a customerservice@paguelofacil.com para configurar el **webhook** hacia `https://tu-dominio.com/api/pagos/webhook`. Esto confirma los pagos de forma segura server-to-server, además de la confirmación que ya ocurre cuando el cliente regresa a tu sitio.

### Endpoints
```
POST /api/facturas/:id/pagar     # cliente, genera el enlace de pago de una factura propia y pendiente
GET  /api/pagos/retorno          # PagueloFacil redirige aquí tras el intento de pago
POST /api/pagos/webhook          # confirmación server-to-server (requiere configurarlo con soporte de PagueloFacil)
```

### Tarjetas de prueba (sandbox)
VISA: `4059310181757001` — Mastercard: `5517747952039692`. Cualquier fecha de vencimiento futura y cualquier CVV de 3 dígitos.

## Fotos de paquetes

Cuando el paquete llega a la bodega, el admin puede subirle fotos (ej. cómo llegó, si tiene algún daño visible). Se guardan en **Cloudinary** (no en el propio servidor, porque el disco de Render se borra en cada reinicio).

- **Admin**: en la pestaña Paquetes, botón "📷 Fotos" abre un modal para subir (hasta 5 a la vez, 5MB c/u), ver y eliminar fotos de ese paquete.
- **Cliente**: en cada paquete de su dashboard, botón "Ver fotos de cómo llegó" muestra las fotos que subió el admin.

### Configurar Cloudinary
1. Crea una cuenta gratis en [cloudinary.com](https://cloudinary.com).
2. En el dashboard principal copia: **Cloud name**, **API Key**, **API Secret**.
3. Agrégalos como variables de entorno: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

### Endpoints
```
POST   /api/admin/paquetes/:id/fotos          # admin, multipart/form-data, campo "fotos" (hasta 5)
GET    /api/admin/paquetes/:id/fotos          # admin
DELETE /api/admin/paquetes/:id/fotos/:fotoId  # admin

GET    /api/paquetes/:id/fotos                # cliente, solo de su propio paquete
```

## Facturación (nuevo)

Flujo pensado así:

1. El **admin** crea una o varias **tarifas** (ej. "Aéreo estándar": $4.50/lb, cargo mínimo $8, cargo de manejo $2, 1.5% de seguro sobre el valor declarado).
2. Cuando un paquete llega a la bodega, el admin confirma su **peso real** (puede diferir del estimado que puso el cliente al prealertar).
3. El admin **genera la factura** de ese paquete eligiendo la tarifa a aplicar. El sistema calcula automáticamente:
   - `costo_envio = max(peso × precio_libra, cargo_mínimo)`
   - `seguro = valor_declarado × (%seguro / 100)`
   - `total = costo_envio + cargo_manejo + seguro`
4. El **cliente** ve sus facturas (pendientes/pagadas) en su cuenta.
5. El admin marca la factura como **pagada** cuando recibe el pago (efectivo, transferencia, etc. — no hay pasarela de tarjeta integrada todavía).

### Endpoints de tarifas (admin)
```
GET    /api/admin/tarifas
POST   /api/admin/tarifas       # { nombre, precio_libra, cargo_minimo, cargo_manejo, pct_seguro, activa }
PUT    /api/admin/tarifas/:id
DELETE /api/admin/tarifas/:id
```

### Confirmar peso real de un paquete (admin)
```
PATCH /api/admin/paquetes/:id/peso
{ "peso_real_lb": 2.3 }
```

### Endpoints de facturas (admin)
```
POST  /api/admin/facturas                  # { paquete_id, tarifa_id } -> genera la factura
GET   /api/admin/facturas                  # todas (filtros: ?estado=&email=)
PATCH /api/admin/facturas/:id/estado       # { "estado": "pagada" }  (pendiente | pagada | anulada)
```

### Endpoints de facturas (cliente)
```
GET /api/facturas          # mis facturas
GET /api/facturas/:id      # detalle de una factura mía
```

### Ejemplo con curl

```bash
# 1. Crear una tarifa
curl -X POST http://localhost:3000/api/admin/tarifas \
  -H "Authorization: Bearer TOKEN_DE_ADMIN" -H "Content-Type: application/json" \
  -d '{"nombre":"Aéreo estándar","precio_libra":4.5,"cargo_minimo":8,"cargo_manejo":2,"pct_seguro":1.5}'

# 2. Confirmar el peso real de un paquete
curl -X PATCH http://localhost:3000/api/admin/paquetes/1/peso \
  -H "Authorization: Bearer TOKEN_DE_ADMIN" -H "Content-Type: application/json" \
  -d '{"peso_real_lb":2.3}'

# 3. Generar la factura
curl -X POST http://localhost:3000/api/admin/facturas \
  -H "Authorization: Bearer TOKEN_DE_ADMIN" -H "Content-Type: application/json" \
  -d '{"paquete_id":1,"tarifa_id":1}'

# 4. Marcar como pagada
curl -X PATCH http://localhost:3000/api/admin/facturas/1/estado \
  -H "Authorization: Bearer TOKEN_DE_ADMIN" -H "Content-Type: application/json" \
  -d '{"estado":"pagada"}'
```

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
