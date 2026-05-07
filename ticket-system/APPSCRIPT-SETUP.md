# Integración con Google Apps Script

Este sistema de tickets puede conectarse directamente al spreadsheet de Google Sheets mediante Google Apps Script.

## Instalación

### 1. Abrir el Spreadsheet
Ve a: https://docs.google.com/spreadsheets/d/1murmG-pdc5GkJ1CYc4_1UISRTcipMxPYv2jiH_-7ZIY/edit

### 2. Abrir Apps Script Editor
- En el menú: **Extensiones > Apps Script**

### 3. Copiar el código
1. Elimina el código por defecto (`function myFunction() {}`)
2. Copia todo el contenido del archivo `appscript-integration.gs`
3. Pégalo en el editor de Apps Script
4. Guarda el proyecto (Ctrl+S)

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

## Sincronización Automática

Para sincronizar automáticamente cada 5 minutos:

1. En Apps Script: **Reloj > Agregar trigger**
2. Función: `syncFromTaskTracker`
3. Evento: `Basado en tiempo`
4. Tipo de timer: `Minutos`
5. Intervalo: `Cada 5 minutos`

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
