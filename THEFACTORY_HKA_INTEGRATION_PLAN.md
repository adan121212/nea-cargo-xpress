# Integración directa The Factory HKA — NEA Cargo Xpress

## Estado

- Rama: `feature/thefactory-hka-integration`
- Rama base: `main`
- Alcance inicial: integración directa por el Web Service API REST de The Factory HKA.
- Producción: deshabilitada hasta completar QA y recibir credenciales/habilitación del PAC.
- Interfaz: no se modifica en esta fase.

## Auditoría del sistema existente

Repositorio revisado: `adan121212/nea-cargo-xpress`.

Arquitectura identificada:
- Node.js CommonJS + Express 4.
- PostgreSQL mediante `pg`, con `DATABASE_URL` para Neon.
- Servidor principal: `server.js`.
- Rutas de facturación del cliente: `routes/facturas.js`.
- Rutas administrativas de facturación: `routes/admin/facturas.js`.
- Pagos y retorno Yappy: `routes/pagos.js`.
- PDF interno: `utils/facturaPdf.js`.
- Esquema y migraciones SQL: `sql/schema.sql` y `sql/migracion_facturacion.sql`.

La facturación actual calcula cargos de paquetes, genera un consecutivo interno, guarda el registro en `facturas`, puede registrar pagos y genera un PDF interno. El pie del PDF indica expresamente: “Comprobante interno — no es una factura fiscal electrónica DGI”.

**Regla de diseño:** conservar el flujo interno y añadir un ciclo fiscal HKA separado. Una factura marcada como pagada no se considerará fiscalmente autorizada por ese solo hecho.

## Modalidad de integración elegida

Se utilizará el Web Service API REST oficial de HKA para Panamá, conectando NEA directamente con el PAC. La documentación oficial describe autenticación JWT y métodos REST para envío, descarga, anulación, consulta de estado y folios restantes.

Ambientes publicados por HKA:
- Demo: `https://demointegracion.thefactoryhka.com.pa/api`
- Producción: `https://integracion.thefactoryhka.com.pa/api`

Métodos documentados:
- `POST /Autenticacion`: recibe `usuario` y `clave`; devuelve JWT.
- `POST /Enviar`: recibe el documento electrónico.
- `POST /EstadoDocumento`: consulta estado usando los datos de identificación fiscal del documento.
- `POST /Descarga`: descarga XML o PDF en Base64 mediante CUFE y tipo de archivo.
- `POST /Anulacion`: solicita anulación con motivo y datos fiscales.
- `GET /FoliosRestantes`: consulta disponibilidad de folios con JWT.

Antes de implementar las cabeceras de autorización, reglas de expiración JWT y todos los campos obligatorios, contrastar los ejemplos oficiales de Postman/JavaScript y el contrato vigente entregado a NEA por HKA. No inferir campos opcionales como obligatorios ni usar credenciales de ejemplo de la documentación.

## Diseño propuesto

Crear un adaptador aislado en `integrations/thefactory/` o `src/integrations/thefactory/` (elegir según la organización actual del proyecto):
- `client.js`: cliente HTTP, autenticación JWT, renovación segura y timeouts.
- `documents.js`: envío, consulta de estado, descarga y anulación.
- `mapper.js`: mapeo de la factura NEA al contrato HKA.
- `validators.js`: validaciones fiscales previas al envío.
- `errors.js`: normalización de errores y respuestas HKA.

La capa de rutas llamará a servicios de facturación fiscal. No se harán llamadas a HKA desde el navegador.

## Modelo fiscal y persistencia

Diseñar una migración aditiva, sin borrar ni renombrar columnas existentes. Como mínimo evaluar:
- proveedor fiscal y ambiente.
- estado fiscal independiente: borrador, pendiente_envio, autorizada, rechazada, resultado_desconocido, anulacion_pendiente, anulada.
- identificadores HKA: CUFE, número de documento fiscal, sucursal, punto de facturación, tipo de documento y tipo de emisión.
- fecha/hora de envío, autorización y última consulta.
- mensaje/código de respuesta.
- XML y PDF/CAFE guardados como referencias/archivos o contenido protegido según política de almacenamiento.
- registro de intentos y auditoría sin almacenar contraseñas ni JWT.

La numeración interna NEA y el consecutivo fiscal HKA deben permanecer separados. El consecutivo fiscal y los datos de sucursal/punto/serial deben seguir las asignaciones oficiales del PAC/DGI.

## Flujo de emisión propuesto

1. NEA calcula y guarda la factura interna dentro de su transacción actual.
2. Se valida que el cliente, RUC/DV cuando corresponda, sucursal, punto, tipo de documento, ítems, CPBS, unidad, impuestos, totales y forma de pago estén completos según el contrato HKA.
3. Se registra una solicitud fiscal local con identificador único antes de llamar al PAC.
4. Se obtiene o reutiliza un JWT vigente y se envía el documento a Demo.
5. Se interpreta la respuesta y se guarda el estado, CUFE y metadatos devueltos.
6. Se consulta el estado y se descarga XML/PDF cuando el documento esté disponible.
7. Se muestra en la ficha de la factura el estado fiscal, sin cambiar el diseño general del sistema.
8. La anulación fiscal se implementa como operación separada, con permisos, motivo y confirmación; no equivale a cambiar solamente `facturas.estado`.

## Controles críticos

- No enviar documentos reales a producción durante desarrollo.
- No reintentar automáticamente un envío cuyo resultado sea incierto por timeout. Primero consultar el estado en HKA para evitar duplicados.
- No marcar una factura como autorizada hasta tener respuesta fiscal verificable y CUFE.
- No marcar un documento fiscal como anulado solo porque la factura interna se anuló.
- No guardar tokens, contraseñas ni certificados en GitHub, código fuente, logs o base de datos sin protección.
- Configurar credenciales y ambiente mediante variables seguras de Render.
- Mantener logs técnicos sin datos personales completos ni secretos.
- No cambiar rutas, vistas ni estilos existentes hasta completar pruebas de regresión.

## Variables de entorno previstas

Los nombres finales se ajustarán al mecanismo de autenticación confirmado por HKA:
- `HKA_ENV=demo`
- `HKA_API_BASE_URL=https://demointegracion.thefactoryhka.com.pa/api`
- `HKA_API_USER`
- `HKA_API_PASSWORD`
- Variables adicionales solo si HKA entrega Token Empresa/Token Password separados o exige parámetros de licencia/dispositivo.

Nunca incluir valores reales en este archivo ni en commits.

## Fases y criterios de aceptación

### Fase 1 — Auditoría y contrato
- Confirmar contrato API y ejemplos oficiales de HKA.
- Confirmar credenciales Demo, sucursal, punto de facturación, serial y licencia/folios.
- Confirmar catálogos fiscales, códigos CPBS y configuración ITBMS aplicable al servicio de NEA.

### Fase 2 — Adaptador
- Autenticación JWT y manejo de expiración.
- Cliente REST con timeout y normalización de errores.
- Pruebas unitarias con respuestas anonimizadas o fixtures.

### Fase 3 — Mapeo fiscal
- Mapear una factura NEA de servicio de carga a un documento HKA.
- Validar consistencia aritmética entre líneas, impuestos, descuentos y total.
- Confirmar si los cargos de flete, manejo y seguro se representan como líneas separadas y qué CPBS/unidad corresponde.

### Fase 4 — Demo
- Enviar documento de prueba autorizado para QA.
- Consultar estado, recuperar CUFE, XML y CAFE/PDF.
- Probar rechazo, timeout, consulta, folios y anulación de prueba.

### Fase 5 — Interfaz y despliegue
- Añadir indicadores fiscales en las pantallas actuales sin rediseñarlas.
- Pruebas de regresión de facturación, caja, pagos, Yappy, correo y PDF interno.
- Desplegar en Render con ambiente Demo primero.
- Producción únicamente tras validación del titular/contador y autorización de HKA.

## Documentación oficial consultada

- HelpDesk HKA — Métodos del Web Service API REST: https://helpdesk.thefactoryhka.com.pa/hc/es-419/articles/34715676831252-M%C3%A9todos-del-Web-Service-API-REST
- Autenticación JWT: https://helpdesk.thefactoryhka.com.pa/hc/es-419/articles/34728586532244-M%C3%A9todo-Autenticaci%C3%B3n-Json-web-token
- Método Enviar: https://helpdesk.thefactoryhka.com.pa/hc/es-419/articles/37538456481812-M%C3%A9todo-Enviar
- Descarga XML/PDF: https://helpdesk.thefactoryhka.com.pa/hc/es-419/articles/37529286072468-M%C3%A9todo-Descarga-XML-PDF
- Estado Documento: https://helpdesk.thefactoryhka.com.pa/hc/es-419/articles/37542752974228-M%C3%A9todo-Estado-Documento
- Folios Restantes: https://helpdesk.thefactoryhka.com.pa/hc/es-419/articles/37668290589460-M%C3%A9todo-Folios-Restantes
