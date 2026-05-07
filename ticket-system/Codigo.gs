/**
 * RETARGET GANTT + ASPECTO CORPORATIVO
 * Todo en uno: Sync Gmail + Formato automático
 * 
 * INSTRUCCIONES:
 * 1. Copiar TODO este código a Código.gs en Apps Script
 * 2. Borrar archivos: aspecto.js.html (si existe)
 * 3. Ejecutar manualmente: ejecutarAhora() o ejecutarForzado() (ignora horario)
 * 4. O crear trigger: crearTriggerSync() (respeta horario 8am-19:00)
 */

// ==================== CONFIGURACIÓN ====================
const SPREADSHEET_ID = '1murmG-pdc5GkJ1CYc4_1UISRTcipMxPYv2jiH_-7ZIY';
const SHEET_NAME = 'Retarget · Gantt Tareas Web — Mayo 2026';

const REMITENTES = [
  'sroblero@tanica.com',
  'leignayih.rodriguez@retarget.cl',
  'mauricio.soto@retarget.cl',
  'mauricio@retarget.cl'
];

const PALABRAS_REQ = [
  'requerimiento', 'ajuste', 'cambio', 'corrección', 'urgente',
  'favor', 'necesito', 'botón', 'landing', 'página', 'arreglar',
  'actualizar', 'modificar', 'agregar', 'eliminar'
];

// Colores por estado
const COLORES_ESTADO = {
  'Pendiente': '#fef3c7',
  'Pendiente OJO': '#fee2e2',
  'Completado': '#d1fae5',
  'En Gestión': '#ede9fe',
  'En Progreso': '#dbeafe',
  'En Clarificación': '#fce7f3',
  'Fallido': '#fee2e2'
};

// Colores por cliente
const COLORES_CLIENTE = {
  'Puyehue': '#10b981',
  'TAC': '#f59e0b',
  'Futangue EN': '#3b82f6',
  'Futangue ES': '#06b6d4',
  'Cabañas': '#8b5cf6',
  'Shopify': '#ec4899',
  'Pueblo La Dehesa': '#f97316',
  'Retarget': '#64748b'
};

// ==================== FUNCIÓN PRINCIPAL ====================

/**
 * Sincroniza Gmail → Gantt + Aplica aspecto corporativo
 * Solo ejecuta en horario laboral (8am-19:00) cuando es trigger automático
 * Trigger: cada 10 minutos
 */
function syncGanttConAspecto() {
  syncGanttConAspectoInterno(false);
}

/**
 * Versión interna con parámetro para forzar ejecución
 * @param {boolean} forzar - true ignora horario laboral
 */
function syncGanttConAspectoInterno(forzar) {
  // Verificar horario laboral (solo si no forzado)
  const ahora = new Date();
  const hora = ahora.getHours();
  
  if (!forzar && (hora < 8 || hora >= 19)) {
    Logger.log(`⏸️ Fuera de horario (${hora}:00). Horario: 8:00-19:00`);
    return;
  }
  
  Logger.log(`🕐 Iniciando sync + aspecto (${hora}:${ahora.getMinutes()})...`);
  
  // PASO 1: Sincronizar desde Gmail
  const nuevosTickets = sincronizarDesdeGmail();
  
  // PASO 2: Aplicar formato corporativo a TODO
  aplicarAspectoCorporativo();
  
  Logger.log(`✅ Proceso completado. Nuevos: ${nuevosTickets}`);
}

/**
 * Sincroniza emails de remitentes conocidos al Gantt
 */
function sincronizarDesdeGmail() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  
  // Obtener tickets existentes
  const ticketsExistentes = data.slice(1).map(r => r[0]);
  const origenesExistentes = data.slice(1).map(r => (r[3] || '').toLowerCase());
  
  // Calcular siguiente número T-xx
  const tNums = ticketsExistentes
    .filter(t => /^T-\d+$/.test(t))
    .map(t => parseInt(t.replace('T-', '')));
  let nextT = tNums.length ? Math.max(...tNums) + 1 : 1;
  
  const nuevasFilas = [];
  const hace3dias = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  
  // Buscar emails de cada remitente
  REMITENTES.forEach(remitente => {
    const query = `from:${remitente} after:${formatDate(hace3dias)}`;
    const threads = GmailApp.search(query, 0, 20);
    
    threads.forEach(thread => {
      const msg = thread.getMessages()[0];
      const asunto = msg.getSubject() || '';
      const cuerpo = msg.getPlainBody().substring(0, 500).toLowerCase();
      const fecha = msg.getDate();
      
      // Filtrar no-reqs
      if (/calendar|invite|invitation|meet|google|notif|share|solicitud/i.test(asunto)) return;
      
      // Verificar si es requerimiento
      const esReq = PALABRAS_REQ.some(p => cuerpo.includes(p) || asunto.toLowerCase().includes(p));
      if (!esReq) return;
      
      // Verificar duplicado
      const yaExiste = origenesExistentes.some(o => o.includes(asunto.substring(0, 20).toLowerCase()));
      if (yaExiste) return;
      
      // Inferir cliente
      const { negocio, sitio } = inferirNegocio(cuerpo + ' ' + asunto.toLowerCase());
      
      nuevasFilas.push([
        `T-${String(nextT++).padStart(2, '0')}`,
        negocio,
        sitio,
        `${asunto} (${remitente} ${formatDateHuman(fecha)})`,
        asunto,
        '',
        'Pendiente',
        formatDateHuman(fecha),
        '',
        'Luis Maldonado'
      ]);
    });
  });
  
  // Agregar nuevas filas
  if (nuevasFilas.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, nuevasFilas.length, 10).setValues(nuevasFilas);
    Logger.log(`📝 ${nuevasFilas.length} ticket(s) nuevos agregados`);
  }
  
  return nuevasFilas.length;
}

/**
 * Aplica aspecto corporativo a TODAS las filas
 */
function aplicarAspectoCorporativo() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) {
    Logger.log('ℹ️ No hay datos para formatear');
    return;
  }
  
  // Formatear HEADER (fila 1)
  const headerRange = sheet.getRange(1, 1, 1, data[0].length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1e293b');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontSize(11);
  
  // Formatear cada fila de datos
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    
    const estado = row[6] || 'Pendiente';
    const negocio = row[1] || '';
    const rowRange = sheet.getRange(i + 1, 1, 1, 7);
    
    // Color de fondo según ESTADO
    const bgColor = COLORES_ESTADO[estado] || '#ffffff';
    rowRange.setBackground(bgColor);
    
    // Color y peso de texto
    if (estado === 'Completado') {
      rowRange.setFontColor('#059669');
      rowRange.setFontLine('line-through');
    } else if (estado === 'Pendiente OJO' || estado === 'Fallido') {
      rowRange.setFontColor('#dc2626');
      rowRange.setFontWeight('bold');
      rowRange.setFontLine('none');
    } else if (estado === 'En Gestión') {
      rowRange.setFontColor('#7c3aed');
      rowRange.setFontWeight('bold');
      rowRange.setFontLine('none');
    } else {
      rowRange.setFontColor('#1e293b');
      rowRange.setFontWeight('normal');
      rowRange.setFontLine('none');
    }
    
    // Color especial para NEGOCIO
    const negocioRange = sheet.getRange(i + 1, 2);
    const clienteColor = COLORES_CLIENTE[negocio] || '#64748b';
    negocioRange.setFontColor(clienteColor);
    negocioRange.setFontWeight('bold');
    
    // Centrar ESTADO
    const estadoRange = sheet.getRange(i + 1, 7);
    estadoRange.setHorizontalAlignment('center');
  }
  
  // Auto-ajustar columnas
  sheet.autoResizeColumns(1, Math.min(data[0].length, 10));
  
  Logger.log(`🎨 Aspecto aplicado a ${data.length - 1} filas`);
}

// ==================== HELPERS ====================

function inferirNegocio(texto) {
  if (texto.includes('puyehue')) return { negocio: 'Puyehue', sitio: 'puyehue.cl' };
  if (texto.includes('futangue')) return { negocio: 'Futangue EN', sitio: 'parquefutangue.com/en/' };
  if (texto.includes('tac') || texto.includes('termas')) return { negocio: 'TAC', sitio: 'termasaguascalientes.cl' };
  if (texto.includes('cabaña') || texto.includes('cabanas')) return { negocio: 'Cabañas', sitio: 'cabanas.parquefutangue.com' };
  if (texto.includes('pueblo') || texto.includes('dehesa')) return { negocio: 'Pueblo La Dehesa', sitio: 'puebloladehesa.cl' };
  if (texto.includes('shopify') || texto.includes('algodones')) return { negocio: 'Shopify', sitio: 'Algodones' };
  return { negocio: 'Retarget', sitio: '' };
}

function formatDate(date) {
  return Utilities.formatDate(date, 'GMT-4', 'yyyy/MM/dd');
}

function formatDateHuman(date) {
  return Utilities.formatDate(date, 'GMT-4', 'dd-MMM-yyyy');
}

// ==================== TRIGGERS ====================

/**
 * Crea el trigger principal: sync + aspecto cada 10 min
 * Solo activo 8am-19:00 (la función verifica horario)
 */
function crearTriggerSync() {
  // Eliminar triggers existentes
  ScriptApp.getProjectTriggers().forEach(t => {
    ScriptApp.deleteTrigger(t);
  });
  
  // Crear trigger cada 10 minutos
  ScriptApp.newTrigger('syncGanttConAspecto')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  Logger.log('✅ Trigger creado: syncGanttConAspecto() cada 10 minutos');
  Logger.log('   ⏰ Horario activo: 8:00 - 19:00');
  Logger.log('   🎨 Aplica aspecto automático a nuevas filas');
}

/**
 * Ejecutar manualmente para prueba (ignora horario laboral)
 */
function ejecutarAhora() {
  Logger.log('▶️ Ejecutando manualmente (ignorando horario)...');
  syncGanttConAspectoInterno(true);  // true = forzar, ignora horario
}

/**
 * Solo aplicar aspecto (sin sync)
 */
function soloAspecto() {
  Logger.log('🎨 Aplicando solo aspecto...');
  aplicarAspectoCorporativo();
}

/**
 * Solo sync (sin aspecto)
 */
function soloSync() {
  Logger.log('📝 Solo sincronizando...');
  sincronizarDesdeGmail();
}

/**
 * Ejecutar manualmente FORZADO (ignora cualquier restricción)
 */
function ejecutarForzado() {
  Logger.log('⚡ Ejecución FORZADA - ignorando horario y restricciones');
  syncGanttConAspectoInterno(true);
}

// ==================== API ENDPOINTS (opcional) ====================

function doGet(e) {
  const action = e.parameter.action || 'list';
  
  try {
    switch (action) {
      case 'list':
        return jsonResponse({ 
          tickets: SpreadsheetApp.openById(SPREADSHEET_ID)
            .getSheetByName(SHEET_NAME)
            .getDataRange()
            .getValues()
            .slice(1)
            .map(r => ({
              ticket: r[0], negocio: r[1], sitio: r[2], 
              origen: r[3], problema: r[4], estado: r[6]
            }))
        });
      default:
        return jsonResponse({ error: 'Acción no válida' }, 400);
    }
  } catch (error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

function jsonResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
