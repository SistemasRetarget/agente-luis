/**
 * Retarget Ticket System - Google Apps Script Integration
 * 
 * Este script se instala en el spreadsheet de Google Sheets
 * y proporciona una API REST para el agente Luis.
 * 
 * URL del Web App: https://script.google.com/macros/s/[SCRIPT_ID]/exec
 */

// Configuración
const SHEET_NAME = 'Tickets';
const HEADERS = ['Ticket', 'Negocio', 'Sitio', 'Origen (Email)', 'Problema', 'Solución', 'Estado'];

/**
 * Punto de entrada para requests HTTP (GET/POST)
 */
function doGet(e) {
  const action = e.parameter.action || 'list';
  
  try {
    switch (action) {
      case 'list':
        return jsonResponse(getTickets());
      case 'stats':
        return jsonResponse(getStats());
      default:
        return jsonResponse({ error: 'Acción no válida' }, 400);
    }
  } catch (error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

function doPost(e) {
  const action = e.parameter.action;
  const data = JSON.parse(e.postData.contents);
  
  try {
    switch (action) {
      case 'create':
        return jsonResponse(createTicket(data));
      case 'update':
        return jsonResponse(updateTicket(data.id, data));
      case 'batch':
        return jsonResponse(batchUpdate(data.tickets));
      default:
        return jsonResponse({ error: 'Acción no válida' }, 400);
    }
  } catch (error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

/**
 * Obtiene todos los tickets del spreadsheet
 */
function getTickets() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    // Crear sheet si no existe
    return { tickets: [], created: false };
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const tickets = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // Saltar filas vacías
    
    tickets.push({
      ticket: row[0],
      negocio: row[1],
      sitio: row[2],
      origen: row[3],
      problema: row[4],
      solucion: row[5] || '',
      estado: row[6] || 'Pendiente',
      rowIndex: i + 1
    });
  }
  
  return { tickets, count: tickets.length };
}

/**
 * Crea un nuevo ticket
 */
function createTicket(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  // Crear sheet si no existe
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    
    // Formatear header
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f1f5f9');
  }
  
  // Generar ID de ticket
  const lastRow = sheet.getLastRow();
  const ticketId = `T-${String(lastRow).padStart(2, '0')}`;
  
  // Agregar fila
  const newRow = [
    ticketId,
    data.cliente || data.negocio || 'Desconocido',
    data.sitio || data.cambio_url || '',
    data.origen || 'sistemas@retarget.cl',
    data.requerimiento || data.problema || '',
    data.solucion || data.notas || '',
    formatEstado(data.estado)
  ];
  
  sheet.appendRow(newRow);
  
  // Aplicar formato según estado
  const rowNum = sheet.getLastRow();
  applyRowFormatting(sheet, rowNum, newRow[6]);
  
  return { 
    success: true, 
    ticket: ticketId,
    row: rowNum
  };
}

/**
 * Actualiza un ticket existente
 */
function updateTicket(id, data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return { error: 'Sheet no encontrado' };
  
  const tickets = getTickets().tickets;
  const ticket = tickets.find(t => t.ticket === id);
  
  if (!ticket) {
    return { error: `Ticket ${id} no encontrado` };
  }
  
  // Actualizar valores
  const row = ticket.rowIndex;
  const updates = [];
  
  if (data.estado !== undefined) {
    sheet.getRange(row, 7).setValue(formatEstado(data.estado));
    updates.push('estado');
  }
  if (data.solucion !== undefined) {
    sheet.getRange(row, 6).setValue(data.solucion);
    updates.push('solucion');
  }
  if (data.sitio !== undefined) {
    sheet.getRange(row, 3).setValue(data.sitio);
    updates.push('sitio');
  }
  
  // Re-aplicar formato
  const estadoActual = data.estado || ticket.estado;
  applyRowFormatting(sheet, row, estadoActual);
  
  return { 
    success: true, 
    ticket: id,
    updates
  };
}

/**
 * Actualización batch desde TaskTracker
 */
function batchUpdate(tasks) {
  const results = [];
  
  for (const task of tasks) {
    try {
      // Buscar si existe
      const existing = findTicketByProblem(task.requerimiento);
      
      if (existing) {
        // Actualizar
        const result = updateTicket(existing.ticket, {
          estado: task.estado,
          solucion: task.notas
        });
        results.push({ action: 'update', ticket: existing.ticket, result });
      } else {
        // Crear nuevo
        const result = createTicket(task);
        results.push({ action: 'create', ticket: result.ticket, result });
      }
    } catch (error) {
      results.push({ action: 'error', error: error.toString() });
    }
  }
  
  return { success: true, processed: results.length, results };
}

/**
 * Busca ticket por descripción del problema
 */
function findTicketByProblem(problema) {
  const tickets = getTickets().tickets;
  return tickets.find(t => t.problema === problema);
}

/**
 * Obtiene estadísticas
 */
function getStats() {
  const tickets = getTickets().tickets;
  
  const stats = {
    total: tickets.length,
    pendientes: tickets.filter(t => t.estado.includes('Pendiente')).length,
    completados: tickets.filter(t => t.estado === 'Completado').length,
    enGestion: tickets.filter(t => t.estado.includes('Gestión')).length,
    porNegocio: {}
  };
  
  tickets.forEach(t => {
    if (!stats.porNegocio[t.negocio]) {
      stats.porNegocio[t.negocio] = 0;
    }
    stats.porNegocio[t.negocio]++;
  });
  
  return stats;
}

/**
 * Aplica formato condicional a la fila según estado
 */
function applyRowFormatting(sheet, row, estado) {
  const range = sheet.getRange(row, 1, 1, 7);
  
  // Colores de fondo según estado
  const colors = {
    'Pendiente': '#fef3c7',
    'Pendiente OJO': '#fee2e2',
    'Completado': '#d1fae5',
    'En Gestión': '#ede9fe',
    'En Progreso': '#dbeafe',
    'En Clarificación': '#fce7f3'
  };
  
  const bgColor = colors[estado] || '#ffffff';
  range.setBackground(bgColor);
  
  // Resetear texto
  range.setFontColor('#1e293b');
  
  // Si es completado, poner en gris claro
  if (estado === 'Completado') {
    range.setFontColor('#64748b');
  }
}

/**
 * Formatea estado al formato del spreadsheet
 */
function formatEstado(estado) {
  const mapping = {
    'pending': 'Pendiente',
    'in_progress': 'En Progreso',
    'clarifying': 'En Clarificación',
    'completed': 'Completado',
    'failed': 'Fallido',
    'gestionando': 'En Gestión'
  };
  return mapping[estado] || estado;
}

/**
 * Helper para respuestas JSON
 */
function jsonResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  
  // Configurar CORS
  return output;
}

/**
 * Función para ejecutar desde el editor (test)
 */
function testCreateTicket() {
  const result = createTicket({
    cliente: 'Puyehue',
    sitio: 'puyehue.cl',
    requerimiento: 'Test desde Apps Script',
    estado: 'pending'
  });
  
  Logger.log(result);
}

/**
 * Sincronización desde TaskTracker (ejecutar periódicamente)
 */
function syncFromTaskTracker() {
  // Esta función se llamaría desde un trigger programado
  // o desde el agente Luis para sincronizar cambios
  
  const url = 'http://tu-agente-luis.com/api/tickets'; // En producción usar la URL real
  
  try {
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());
    
    if (data.tickets) {
      batchUpdate(data.tickets);
    }
    
    Logger.log(`Sincronizados ${data.tickets.length} tickets`);
  } catch (error) {
    Logger.log('Error en sincronización: ' + error);
  }
}

/**
 * Crea triggers automáticos al instalar
 */
function createInstallableTrigger() {
  // Crear trigger para sincronización automática cada 5 minutos
  ScriptApp.newTrigger('syncFromTaskTracker')
    .timeBased()
    .everyMinutes(5)
    .create();
  
  Logger.log('Trigger de sincronización creado');
}

/**
 * Aplica formato corporativo a TODAS las filas del spreadsheet
 * Útil después de sincronizar desde Gmail
 */
function formatAllRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log('Sheet no encontrado');
    return;
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    Logger.log('No hay datos para formatear');
    return;
  }
  
  // Formatear header
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1e293b');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontSize(11);
  
  // Formatear cada fila de datos
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // Saltar filas vacías
    
    const estado = row[6] || 'Pendiente';
    const negocio = row[1] || '';
    
    applyFullRowFormatting(sheet, i + 1, estado, negocio);
  }
  
  // Auto-ajustar columnas
  sheet.autoResizeColumns(1, HEADERS.length);
  
  Logger.log(`✅ Formateadas ${data.length - 1} filas con aspecto corporativo`);
}

/**
 * Aplica formato completo a una fila (estado + cliente)
 */
function applyFullRowFormatting(sheet, row, estado, negocio) {
  const range = sheet.getRange(row, 1, 1, 7);
  
  // Colores de fondo según ESTADO
  const estadoColors = {
    'Pendiente': '#fef3c7',
    'Pendiente OJO': '#fee2e2',
    'Completado': '#d1fae5',
    'En Gestión': '#ede9fe',
    'En Progreso': '#dbeafe',
    'En Clarificación': '#fce7f3',
    'Fallido': '#fee2e2'
  };
  
  // Colores según NEGOCIO (bordes sutiles)
  const negocioColors = {
    'Puyehue': '#10b981',
    'TAC': '#f59e0b',
    'Futangue EN': '#3b82f6',
    'Futangue ES': '#06b6d4',
    'Cabañas': '#8b5cf6',
    'Shopify': '#ec4899',
    'Pueblo La Dehesa': '#f97316',
    'Retarget': '#64748b'
  };
  
  // Aplicar color de estado
  const bgColor = estadoColors[estado] || '#ffffff';
  range.setBackground(bgColor);
  
  // Aplicar color de texto según estado
  if (estado === 'Completado') {
    range.setFontColor('#059669');
    range.setFontWeight('normal');
  } else if (estado === 'Pendiente OJO' || estado === 'Fallido') {
    range.setFontColor('#dc2626');
    range.setFontWeight('bold');
  } else if (estado === 'En Gestión') {
    range.setFontColor('#7c3aed');
    range.setFontWeight('bold');
  } else {
    range.setFontColor('#1e293b');
    range.setFontWeight('normal');
  }
  
  // Formato especial para celda de negocio
  const negocioRange = sheet.getRange(row, 2);
  const negocioColor = negocioColors[negocio] || '#64748b';
  negocioRange.setFontWeight('bold');
  negocioRange.setFontColor(negocioColor);
  
  // Formato para celda de estado
  const estadoRange = sheet.getRange(row, 7);
  estadoRange.setHorizontalAlignment('center');
  
  // Si está completado, tachar opcionalmente
  if (estado === 'Completado') {
    range.setFontLine('line-through');
  } else {
    range.setFontLine('none');
  }
}

/**
 * Versión mejorada de syncGantt que también aplica formato
 * Combina la lógica del usuario con formateo automático
 */
function syncGanttConFormato() {
  // Ejecutar syncGantt original (del código del usuario)
  syncGantt();
  
  // Esperar un momento y aplicar formato
  Utilities.sleep(1000);
  formatAllRows();
  
  Logger.log('✅ Sincronización completada con formato corporativo');
}

/**
 * Crea trigger que ejecuta syncGantt + formato automático
 */
function crearTriggerConFormato() {
  // Eliminar triggers existentes
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncGantt' || t.getHandlerFunction() === 'syncGanttConFormato') {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // Crear nuevo trigger
  ScriptApp.newTrigger('syncGanttConFormato')
    .timeBased()
    .everyHours(3)
    .create();
  
  Logger.log('✅ Trigger creado — sincroniza y formatea cada 3 horas');
}
