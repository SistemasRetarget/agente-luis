/**
 * Retarget Ticket System - App Logic
 * Integrates with Google Sheets API
 * Estructura: Ticket | Negocio | Sitio | Origen(Email) | Problema | Solución | Estado
 */

// Estado de la aplicación
const state = {
    tickets: [],
    filteredTickets: [],
    currentView: 'dashboard',
    filters: {
        search: '',
        negocio: '',
        estado: '',
        origen: ''
    }
};

// Configuración de columnas según el spreadsheet
const COLUMNAS = {
    TICKET: 0,      // A - ID del ticket (T-01, T-02, etc.)
    NEGOCIO: 1,     // B - Cliente/Negocio (Puyehue, TAC, Futangue, etc.)
    SITIO: 2,       // C - URL del sitio
    ORIGEN: 3,      // D - Email de origen
    PROBLEMA: 4,    // E - Descripción del problema/requerimiento
    SOLUCION: 5,    // F - Solución implementada
    ESTADO: 6       // G - Estado (Pendiente, Completado, etc.)
};

// Colores por cliente
const CLIENT_COLORS = {
    'Puyehue': { color: '#10b981', bg: '#d1fae5' },
    'TAC': { color: '#f59e0b', bg: '#fef3c7' },
    'Futangue EN': { color: '#3b82f6', bg: '#dbeafe' },
    'Futangue ES': { color: '#06b6d4', bg: '#cffafe' },
    'Cabañas': { color: '#8b5cf6', bg: '#ede9fe' },
    'Shopify': { color: '#ec4899', bg: '#fce7f3' }
};

// Estados y sus estilos
const ESTADOS = {
    'Pendiente': { class: 'estado-pendiente', label: 'Pendiente', color: '#f59e0b' },
    'Pendiente OJO': { class: 'estado-pendiente-ojo', label: 'Pendiente OJO', color: '#ef4444' },
    'Completado': { class: 'estado-completado', label: 'Completado', color: '#10b981' },
    'En Progreso': { class: 'estado-progreso', label: 'En Progreso', color: '#3b82f6' },
    'Gestiónando por Leignah': { class: 'estado-gestion', label: 'En Gestión', color: '#8b5cf6' }
};

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    setupEventListeners();
    showLoading();
    
    // Intentar cargar desde Google Sheets
    try {
        await loadFromGoogleSheets();
    } catch (error) {
        console.warn('No se pudo cargar desde Google Sheets, usando datos de ejemplo:', error);
        loadSampleData();
    }
    
    updateStats();
    renderTickets();
    updateClientFilters();
}

// Configurar event listeners
function setupEventListeners() {
    // Filtros
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        state.filters.search = e.target.value.toLowerCase();
        applyFilters();
    });
    
    document.getElementById('filter-negocio')?.addEventListener('change', (e) => {
        state.filters.negocio = e.target.value;
        applyFilters();
    });
    
    document.getElementById('filter-estado')?.addEventListener('change', (e) => {
        state.filters.estado = e.target.value;
        applyFilters();
    });
    
    document.getElementById('refresh-btn')?.addEventListener('click', () => {
        showLoading();
        setTimeout(() => {
            initApp();
        }, 500);
    });
    
    // Modal nuevo ticket
    document.getElementById('new-ticket-btn')?.addEventListener('click', openModal);
    document.querySelector('.modal-close')?.addEventListener('click', closeModal);
    document.querySelector('.modal-overlay')?.addEventListener('click', closeModal);
    document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
    
    document.getElementById('ticket-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        createTicket(e.target);
    });
    
    // Navegación
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            switchView(item.dataset.view);
        });
    });
}

// Cargar datos desde API del Agente Luis
async function loadFromGoogleSheets() {
    // Intentar cargar desde API local del agente primero
    try {
        const response = await fetch('http://localhost:3000/api/tickets');
        if (response.ok) {
            const data = await response.json();
            if (data.tickets && data.tickets.length > 0) {
                state.tickets = data.tickets;
                state.filteredTickets = [...state.tickets];
                return;
            }
        }
    } catch (error) {
        console.log('API local no disponible, usando datos de ejemplo:', error.message);
    }
    
    // Fallback: datos de ejemplo basados en el screenshot
    loadSampleData();
}

// Datos de ejemplo si no hay conexión
function loadSampleData() {
    state.tickets = [
        {
            id: 'T-01',
            negocio: 'TAC',
            sitio: 'termasaguascalientes.cl',
            origen: 'susan@retarget.cl',
            problema: 'Ajustes landing excursiones desactualizado',
            solucion: 'Página donada - Pendiente OJO',
            estado: 'Pendiente OJO',
            fecha: new Date().toISOString()
        },
        {
            id: 'T-02',
            negocio: 'Puyehue',
            sitio: 'puyehue.cl',
            origen: 'susan@retarget.cl',
            problema: 'Ajustes HTF Botones en página Ven por el Día',
            solucion: '',
            estado: 'Pendiente',
            fecha: new Date().toISOString()
        }
    ];
    state.filteredTickets = [...state.tickets];
}

// Renderizar tickets
function renderTickets() {
    const tbody = document.getElementById('tickets-body');
    const emptyState = document.getElementById('empty-state');
    const tableContainer = document.querySelector('.table-container');
    
    if (!tbody) return;
    
    if (state.filteredTickets.length === 0) {
        tbody.innerHTML = '';
        tableContainer.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    tableContainer.style.display = 'block';
    emptyState.style.display = 'none';
    
    tbody.innerHTML = state.filteredTickets.map(ticket => {
        const clientStyle = CLIENT_COLORS[ticket.negocio] || { color: '#64748b', bg: '#f1f5f9' };
        const estadoStyle = ESTADOS[ticket.estado] || ESTADOS['Pendiente'];
        
        return `
            <tr data-id="${ticket.id}">
                <td><strong>${ticket.id}</strong></td>
                <td>
                    <span class="client-badge" style="background: ${clientStyle.bg}; color: ${clientStyle.color}">
                        ${ticket.negocio}
                    </span>
                </td>
                <td>
                    <a href="https://${ticket.sitio}" target="_blank" class="site-link">
                        ${ticket.sitio}
                    </a>
                </td>
                <td class="email-cell" title="${ticket.origen}">${ticket.origen}</td>
                <td class="problem-cell">
                    <div class="problem-text" title="${ticket.problema}">${ticket.problema}</div>
                </td>
                <td>
                    <span class="estado-badge ${estadoStyle.class}">
                        ${estadoStyle.label}
                    </span>
                </td>
                <td>
                    <button class="btn-icon" onclick="viewTicket('${ticket.id}')" title="Ver detalle">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                            <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                        </svg>
                    </button>
                    <button class="btn-icon" onclick="editTicket('${ticket.id}')" title="Editar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    // Actualizar contador
    const ticketCount = document.getElementById('ticket-count');
    if (ticketCount) {
        ticketCount.textContent = state.filteredTickets.length;
    }
}

// Aplicar filtros
function applyFilters() {
    state.filteredTickets = state.tickets.filter(ticket => {
        const matchesSearch = !state.filters.search || 
            ticket.problema.toLowerCase().includes(state.filters.search) ||
            ticket.id.toLowerCase().includes(state.filters.search) ||
            ticket.sitio.toLowerCase().includes(state.filters.search);
        
        const matchesNegocio = !state.filters.negocio || ticket.negocio === state.filters.negocio;
        const matchesEstado = !state.filters.estado || ticket.estado.includes(state.filters.estado);
        
        return matchesSearch && matchesNegocio && matchesEstado;
    });
    
    renderTickets();
}

// Actualizar estadísticas
function updateStats() {
    const total = state.tickets.length;
    const pendientes = state.tickets.filter(t => t.estado.includes('Pendiente')).length;
    const completados = state.tickets.filter(t => t.estado === 'Completado').length;
    const enGestion = state.tickets.filter(t => t.estado.includes('Gestion')).length;
    
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pending').textContent = pendientes;
    document.getElementById('stat-completed').textContent = completados;
    document.getElementById('stat-gestion').textContent = enGestion;
}

// Actualizar filtros de cliente
function updateClientFilters() {
    const select = document.getElementById('filter-negocio');
    if (!select) return;
    
    const negocios = [...new Set(state.tickets.map(t => t.negocio))].sort();
    
    select.innerHTML = `
        <option value="">Todos los negocios</option>
        ${negocios.map(n => `<option value="${n}">${n}</option>`).join('')}
    `;
}

// Cambiar vista
function switchView(view) {
    state.currentView = view;
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === view) {
            item.classList.add('active');
        }
    });
    
    const title = document.querySelector('.page-title');
    const subtitle = document.querySelector('.page-subtitle');
    
    switch(view) {
        case 'dashboard':
            title.textContent = 'Dashboard';
            subtitle.textContent = 'Gestión de tickets y requerimientos';
            break;
        case 'tickets':
            title.textContent = 'Tickets';
            subtitle.textContent = 'Todos los tickets del sistema';
            break;
        case 'reports':
            title.textContent = 'Reportes';
            subtitle.textContent = 'Análisis y métricas';
            break;
    }
}

// Modal functions
function openModal() {
    document.getElementById('new-ticket-modal').classList.add('active');
}

function closeModal() {
    document.getElementById('new-ticket-modal').classList.remove('active');
    document.getElementById('ticket-form').reset();
}

function createTicket(form) {
    const formData = new FormData(form);
    
    const newTicket = {
        id: `T-${String(state.tickets.length + 1).padStart(2, '0')}`,
        negocio: formData.get('negocio'),
        sitio: formData.get('sitio') || '',
        origen: 'sistemas@retarget.cl',
        problema: formData.get('problema'),
        solucion: '',
        estado: formData.get('estado'),
        fecha: new Date().toISOString()
    };
    
    state.tickets.unshift(newTicket);
    applyFilters();
    updateStats();
    closeModal();
    
    // Mostrar notificación
    showNotification('Ticket creado exitosamente', 'success');
}

// Ver ticket
function viewTicket(id) {
    const ticket = state.tickets.find(t => t.id === id);
    if (!ticket) return;
    
    alert(`Ticket: ${ticket.id}\nNegocio: ${ticket.negocio}\nProblema: ${ticket.problema}\nEstado: ${ticket.estado}`);
}

// Editar ticket
function editTicket(id) {
    const ticket = state.tickets.find(t => t.id === id);
    if (!ticket) return;
    
    // Aquí se abriría un modal de edición
    console.log('Editar ticket:', ticket);
}

// Mostrar loading
function showLoading() {
    const tbody = document.getElementById('tickets-body');
    if (tbody) {
        tbody.innerHTML = `
            <tr class="loading-row">
                <td colspan="7">
                    <div class="loading">
                        <div class="spinner"></div>
                        <span>Cargando tickets...</span>
                    </div>
                </td>
            </tr>
        `;
    }
}

// Notificación
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Exportar funciones globales
window.viewTicket = viewTicket;
window.editTicket = editTicket;
