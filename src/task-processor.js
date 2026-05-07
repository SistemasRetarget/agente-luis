import { google } from 'googleapis';
import { promises as fs } from 'fs';
import path from 'path';
import { TaskTracker } from './task-tracker.js';

const TASKS_FILE = path.join(process.cwd(), 'data', 'tasks.json');

export class TaskProcessor {
  constructor(agente, mcpClient) {
    this.agente = agente;
    this.mcp = mcpClient;
    this.gmail = null;
    this.processing = false;
    this.taskTracker = new TaskTracker();
  }

  async initGmail(auth) {
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  // Busca emails no leídos con label específico o de remitentes autorizados
  async fetchPendingTasks() {
    if (!this.gmail) throw new Error('Gmail no inicializado');

    // Buscar emails no leídos con subject que contenga "[TAREA]" o "[TASK]"
    const query = 'is:unread subject:([TAREA] OR [TASK]) to:sistemas@retarget.cl';
    
    const res = await this.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 10
    });

    const tasks = [];
    
    for (const msg of res.data.messages || []) {
      const detail = await this.gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full'
      });

      const headers = detail.data.payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const from = headers.find(h => h.name === 'From')?.value || '';
      
      // Extraer body
      let body = '';
      if (detail.data.payload.parts) {
        const textPart = detail.data.payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf8');
        }
      }

      tasks.push({
        id: msg.id,
        threadId: msg.threadId,
        subject,
        from,
        body: body.substring(0, 2000), // limitar tamaño
        receivedAt: new Date(parseInt(detail.data.internalDate)).toISOString()
      });
    }

    return tasks;
  }

  // Parsear tarea del email usando Claude
  async parseTask(task) {
    const prompt = `
Analiza este email de tarea y extrae:
1. Tipo de acción (deploy, config, update, fix, create, delete)
2. Proyecto/sitio afectado
3. Detalles específicos
4. Prioridad (high, medium, low)
5. Herramientas MCP necesarias (si aplica)

Email:
De: ${task.from}
Asunto: ${task.subject}
Contenido: ${task.body}

Responde SOLO en JSON:
{
  "action": "tipo",
  "project": "nombre",
  "details": "descripción",
  "priority": "high|medium|low",
  "tools": ["tool1", "tool2"],
  "confirm": true/false
}
`;

    const result = await this.agente.procesarMensaje(prompt, []);
    
    try {
      // Extraer JSON de la respuesta
      const jsonMatch = result.respuesta.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Error parseando tarea:', e);
    }

    return null;
  }

  // Ejecutar tarea parseada
  async executeTask(parsed, originalTask) {
    const execution = {
      id: originalTask.id,
      timestamp: new Date().toISOString(),
      action: parsed.action,
      project: parsed.project,
      status: 'pending',
      result: null,
      error: null
    };

    // Crear tarea en TaskTracker para el supervisor
    await this.taskTracker.createTask({
      cliente: parsed.project || 'desconocido',
      requerimiento: parsed.details || originalTask.subject,
      estado: 'in_progress',
      prioridad: parsed.priority || 'medium',
      notas: `Procesado desde email: ${originalTask.from}`
    });

    try {
      // Mapeo de acciones a herramientas MCP o comandos
      switch (parsed.action) {
        case 'deploy':
          execution.result = await this.actionDeploy(parsed);
          break;
        case 'config':
          execution.result = await this.actionConfig(parsed);
          break;
        case 'update':
          execution.result = await this.actionUpdate(parsed);
          break;
        case 'fix':
          execution.result = await this.actionFix(parsed);
          break;
        case 'create':
          execution.result = await this.actionCreate(parsed);
          break;
        default:
          // Delegar a Claude con herramientas MCP
          const toolResult = await this.delegateToAgent(parsed, originalTask);
          execution.result = toolResult;
      }

      execution.status = 'completed';
      
      // Actualizar tarea en TaskTracker como completada
      const tasks = await this.taskTracker.getTasks({ cliente: parsed.project });
      if (tasks.length > 0) {
        await this.taskTracker.updateTask(tasks[0].id, {
          estado: 'completed',
          notas: tasks[0].notas + '\nCompletado exitosamente',
          cambio_url: execution.result?.url || execution.result?.commit || null
        });
      }
    } catch (error) {
      execution.status = 'failed';
      execution.error = error.message;
      
      // Actualizar tarea en TaskTracker como fallida
      const tasks = await this.taskTracker.getTasks({ cliente: parsed.project });
      if (tasks.length > 0) {
        await this.taskTracker.updateTask(tasks[0].id, {
          estado: 'failed',
          notas: tasks[0].notas + `\nError: ${error.message}`
        });
      }
    }

    // Guardar registro
    await this.saveExecution(execution);

    // Marcar email como leído si fue exitoso
    if (execution.status === 'completed') {
      await this.markAsRead(originalTask.id);
    }

    return execution;
  }

  // Acciones específicas
  async actionDeploy(parsed) {
    // Usar MCP para deploy si está disponible
    if (this.mcp?.tools?.find(t => t.name === 'deploy')) {
      return await this.mcp.callTool('deploy', { project: parsed.project });
    }
    return { manual: `Deploy manual requerido para ${parsed.project}` };
  }

  async actionConfig(parsed) {
    if (this.mcp?.tools?.find(t => t.name === 'config_update')) {
      return await this.mcp.callTool('config_update', { 
        project: parsed.project,
        changes: parsed.details 
      });
    }
    return { manual: `Configuración manual: ${parsed.details}` };
  }

  async actionUpdate(parsed) {
    // Trigger git pull + rebuild
    return { action: 'git_pull_and_rebuild', project: parsed.project };
  }

  async actionFix(parsed) {
    // Delegar al agente con contexto del problema
    const fixPrompt = `Corrige este problema en ${parsed.project}: ${parsed.details}`;
    const result = await this.agente.procesarMensaje(fixPrompt, []);
    return { fixed: true, solution: result.respuesta };
  }

  async actionCreate(parsed) {
    return { created: false, reason: 'Creación requiere aprobación manual' };
  }

  async delegateToAgent(parsed, task) {
    const prompt = `
Ejecuta esta tarea de administración:
Acción: ${parsed.action}
Proyecto: ${parsed.project}
Detalles: ${parsed.details}
Herramientas disponibles: ${JSON.stringify(this.mcp?.tools?.map(t => t.name))}

Usa las herramientas MCP disponibles para completar la tarea.
`;
    const result = await this.agente.procesarMensaje(prompt, []);
    return { delegated: true, result: result.respuesta };
  }

  // Persistencia
  async saveExecution(execution) {
    await fs.mkdir(path.dirname(TASKS_FILE), { recursive: true });
    
    let history = [];
    try {
      const data = await fs.readFile(TASKS_FILE, 'utf8');
      history = JSON.parse(data);
    } catch (e) {
      // Archivo no existe
    }

    history.push(execution);
    await fs.writeFile(TASKS_FILE, JSON.stringify(history, null, 2));
  }

  async loadHistory() {
    try {
      const data = await fs.readFile(TASKS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  }

  async markAsRead(messageId) {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD']
      }
    });
  }

  // Loop principal de procesamiento
  async startProcessing(intervalMinutes = 5) {
    if (this.processing) return;
    this.processing = true;

    console.log(`⏳ Task processor iniciado (cada ${intervalMinutes} min)`);

    const loop = async () => {
      if (!this.processing) return;

      try {
        const tasks = await this.fetchPendingTasks();
        console.log(`📧 ${tasks.length} tareas pendientes`);

        for (const task of tasks) {
          console.log(`🔍 Procesando: ${task.subject}`);
          
          const parsed = await this.parseTask(task);
          if (!parsed) {
            console.log('❌ No se pudo parsear la tarea');
            continue;
          }

          // Si requiere confirmación, notificar pero no ejecutar
          if (parsed.confirm) {
            console.log(`⏸️ Tarea requiere confirmación: ${parsed.action} en ${parsed.project}`);
            await this.sendNotification(task, 'confirm_required', parsed);
            continue;
          }

          console.log(`🚀 Ejecutando: ${parsed.action} en ${parsed.project}`);
          const result = await this.executeTask(parsed, task);
          
          console.log(`✅ Resultado: ${result.status}`);
          await this.sendNotification(task, result.status, result);
        }
      } catch (error) {
        console.error('Error en loop:', error);
      }

      // Schedule next
      setTimeout(loop, intervalMinutes * 60 * 1000);
    };

    loop();
  }

  stopProcessing() {
    this.processing = false;
  }

  async sendNotification(task, status, details) {
    // Enviar respuesta al thread del email o log
    console.log(`📨 Notificación [${status}]: ${task.subject}`);
    // TODO: Implementar envío de email de respuesta
  }
}
