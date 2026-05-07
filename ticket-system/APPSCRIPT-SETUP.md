# Integración con Google Apps Script

Este sistema de tickets puede conectarse directamente al spreadsheet de Google Sheets mediante Google Apps Script.

## Instalación

### 1. Abrir el Spreadsheet
Ve a: https://docs.google.com/spreadsheets/d/1murmG-pdc5GkJ1CYc4_1UISRTcipMxPYv2jiH_-7ZIY/edit

### 2. Abrir Apps Script Editor
- En el menú: **Extensiones > Apps Script**

### 3. Copiar el código (IMPORTANTE)
1. **BORRA** el archivo `aspecto.js.html` si existe (clic derecho > Eliminar)
2. En `Código.gs`, elimina TODO el código existente
3. Copia todo el contenido del archivo `Codigo.gs` (nuevo, unificado)
4. Pégalo en `Código.gs`
5. Guarda el proyecto (Ctrl+S)

### 4. Desplegar como Web App
1. Haz clic en **Desplegar > Nuevo despliegue**
2. Tipo: **Aplicación web**
3. Descripción: "Retarget Ticket API"
4. Ejecutar como: **Yo**
5. Acceso: **Cualquiera** (o "Solo yo" si es privado)
6. Haz clic en **Desplegar**
7. Copia la URL del Web App (termina en `/exec`)

### 5. Configurar el frontend
1. Abre `ticket-system/app.js`
2. Reemplaza `TU_SCRIPT_ID` con tu ID real:
```javascript
APPSCRIPT_API: 'https://script.google.com/macros/s/AKfycbxXXXXXXXX/exec',
```
3. Cambia `USE_APPSCRIPT: true`

### 6. Probar
```bash
open ticket-system/index.html
```

## API Endpoints del Apps Script

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `?action=list` | GET | Lista todos los tickets |
| `?action=stats` | GET | Obtiene estadísticas |
| `?action=create` | POST | Crea un nuevo ticket |
| `?action=update&id=T-01` | POST | Actualiza un ticket |
| `?action=batch` | POST | Sincronización batch |

## Ejemplo de uso desde el Agente Luis

```javascript
// Crear ticket desde el agente
const ticket = {
  cliente: 'Puyehue',
  sitio: 'puyehue.cl',
  requerimiento: 'Ajustes en botones del home',
  estado: 'pending'
};

fetch('https://script.google.com/macros/s/TU_ID/exec?action=create', {
  method: 'POST',
  body: JSON.stringify(ticket)
});
```

## Sincronización Automática (Todo en Uno)

El nuevo `Codigo.gs` combina **sync + aspecto** automáticamente:

### Opción A: Ejecutar función directamente
```javascript
crearTriggerSync()  // Crea trigger cada 10 min, horario 8am-19:00
```

### Opción B: Manual desde el editor
1. Ejecuta `ejecutarAhora()` - Sync + aspecto inmediato
2. Ejecuta `soloAspecto()` - Solo formatear sin sync
3. Ejecuta `soloSync()` - Solo sync sin formatear

### Funciones principales:
- `syncGanttConAspecto()` - Sync Gmail + aplicar colores
- `sincronizarDesdeGmail()` - Solo leer emails y agregar filas
- `aplicarAspectoCorporativo()` - Formatear TODO el spreadsheet

## Formato del Spreadsheet

| Columna | Contenido | Ejemplo |
|---------|-----------|---------|
| A | Ticket ID | T-01 |
| B | Negocio | Puyehue |
| C | Sitio | puyehue.cl |
| D | Origen (Email) | susan@retarget.cl |
| E | Problema | Ajustes en botones... |
| F | Solución | Completado - links... |
| G | Estado | Pendiente / Completado |

## Colores Automáticos

El Apps Script aplica colores de fondo según el estado:
- 🟡 **Pendiente** - Amarillo claro
- 🔴 **Pendiente OJO** - Rojo claro
- 🟢 **Completado** - Verde claro
- 🟣 **En Gestión** - Púrpura claro
- 🔵 **En Progreso** - Azul claro
- 🩷 **En Clarificación** - Rosa claro
