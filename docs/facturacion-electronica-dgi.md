# NEA Cargo Xpress — Integración de Facturación Electrónica DGI Panamá

## Estado del proyecto
- Rama de trabajo: `feature/facturacion-electronica-demo`
- PAC: todavía no contratado.
- La factura interna existente se conserva como documento operativo y origen de los datos.
- La demo visual está en `public/facturacion-fiscal-demo.html`.
- Esta demo no emite documentos fiscales ni genera CUFE, CAFE, QR o autorizaciones reales.

## Hallazgos del repositorio
- Backend CommonJS con Node.js y Express.
- PostgreSQL mediante `pg` y `db.js`.
- Facturación interna implementada en `routes/admin/facturas.js`.
- PDF interno existente mediante `utils/facturaPdf.js`.
- Facturas actuales relacionadas con paquetes y clientes.
- El esquema inicial contiene importes agregados de envío, manejo, seguro y total; no contiene todavía una estructura fiscal completa.
- El servidor registra rutas de facturación cliente y administrador.

## Arquitectura propuesta
1. Mantener intacto el flujo actual de facturas internas.
2. Añadir un módulo fiscal independiente que lea la factura interna y prepare el documento fiscal.
3. Añadir un adaptador PAC intercambiable, sin acoplar el negocio a un proveedor específico.
4. Guardar XML, estados, identificadores fiscales, respuesta del PAC, eventos y trazabilidad en tablas propias.
5. Solo marcar un documento como autorizado cuando el PAC devuelva una autorización verificable.
6. No sustituir ni borrar el PDF interno existente; el CAFE/documento fiscal autorizado será un artefacto separado.

## Estructura propuesta
```
services/fiscal/
  fiscalEngine.js
  xmlGenerator.js
  xmlValidator.js
  firmaDigital.js
  cufeService.js
  pacService.js
providers/pac/
  pacInterface.js
  pacAdapter.js
routes/fiscal/
  facturas.js
  notas-credito.js
  notas-debito.js
  eventos.js
  consultas.js
sql/
  migracion_fiscal_pac.sql
public/
  facturacion-fiscal-demo.html
```

## Datos fiscales por diseñar
- Configuración del emisor y sucursal.
- Identificación del receptor y tipo de contribuyente.
- Tipo de documento, consecutivo y fecha fiscal.
- Detalle por línea, unidad, cantidad, precio, descuentos e impuestos.
- XML original y versión/esquema utilizado.
- Estado de envío, rechazo o autorización.
- CUFE, CAFE y QR únicamente cuando corresponda y sean devueltos/calculados conforme a la ficha técnica.
- Respuestas del PAC, eventos y bitácora de cambios.
- Relación con la factura interna NEA.

## Reglas de seguridad y operación
- No almacenar certificados ni llaves privadas en GitHub.
- Secretos del PAC y material de firma se gestionarán fuera del repositorio, en el gestor seguro de secretos del entorno.
- No usar datos reales de clientes en la demo.
- No conectar a producción ni ejecutar migraciones sobre la base productiva durante esta fase.
- Probar primero en rama y base de datos separadas.
- No asumir que todos los conceptos actuales (envío, manejo, seguro, descuentos) reciben el mismo tratamiento de ITBMS. El contador debe confirmar el tratamiento tributario y los tipos de operación.
- No inventar CUFE, QR ni estado de autorización en pruebas.

## Próximas fases técnicas
1. Confirmar y aprobar el diseño visual.
2. Definir con contador los datos del emisor, receptor, impuestos y tipos de operación.
3. Elegir PAC y obtener su documentación/API de pruebas.
4. Implementar migración fiscal idempotente en base de pruebas.
5. Implementar motor fiscal y adaptador PAC en ambiente de pruebas.
6. Probar autorización, rechazo, reintentos, notas de crédito/débito, eventos y contingencia.
7. Revisión final antes de desplegar y activar emisión real.

## Advertencia
La pantalla es un prototipo visual. No debe presentarse ni utilizarse como factura fiscal. La implementación real dependerá de la ficha técnica vigente de DGI, la certificación y credenciales necesarias, la configuración tributaria confirmada y el contrato/API del PAC elegido.
