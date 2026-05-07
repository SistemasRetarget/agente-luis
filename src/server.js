import express from 'express';
import { MCPClient } from './mcp-client.js';
import { AgenteLuis } from './agent.js';
import { TaskProcessor } from './task-processor.js';
import { GmailAuth } from './gmail-auth.js';

const app = express();
app.use(express.json());

let mcpClient = null;
let agente = null;
let taskProcessor = null;
const sessions = new Map();

export async function startServer(port) {
  // Conectar a MCP al iniciar (opcional - el servidor puede funcionar sin MCP)
  try {
    mcpClient = new MCPClient();
    await mcpClient.connect();
    console.log('✅ MCP Client conectado');
  } catch (error) {
    console.warn('⚠️ MCP no disponible:', error.message);
    console.warn('   El servidor funcionará en modo degradado (sin herramientas MCP)');
    mcpClient = null;
  }
  
  agente = new AgenteLuis(mcpClient);

  // Rutas
  app.post('/chat', async (req, res) => {
    try {
      const { mensaje, sessionId = 'default' } = req.body;
      
      if (!mensaje) {
        return res.status(400).json({ error: 'mensaje requerido' });
      }

      const historial = sessions.get(sessionId) || [];
      const resultado = await agente.procesarMensaje(mensaje, historial);
      
      // Guardar historial
      sessions.set(sessionId, resultado.historial);

      res.json({
        respuesta: resultado.respuesta,
        sessionId
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      mcpConnected: !!mcpClient?.client,
      herramientas: mcpClient?.tools?.length || 0,
      timestamp: new Date().toISOString()
    });
  });

  app.post('/reset', (req, res) => {
    const { sessionId } = req.body;
    if (sessionId) {
      sessions.delete(sessionId);
    } else {
      sessions.clear();
    }
    res.json({ ok: true });
  });

  // Task Processor - Gmail OAuth
  app.get('/gmail/auth', async (req, res) => {
    try {
      const gmailAuth = new GmailAuth();
      const url = await gmailAuth.getAuthUrl();
      res.json({ authUrl: url });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/oauth2callback', async (req, res) => {
    try {
      const { code } = req.query;
      if (!code) return res.status(400).send('Código no proporcionado');
      
      const gmailAuth = new GmailAuth();
      await gmailAuth.saveToken(code);
      
      res.send('✅ Autenticación Gmail exitosa. Puedes cerrar esta ventana.');
    } catch (error) {
      res.status(500).send(`Error: ${error.message}`);
    }
  });

  // Task Processor - Control
  app.post('/tasks/start', async (req, res) => {
    try {
      if (taskProcessor?.processing) {
        return res.json({ status: 'already_running' });
      }

      const gmailAuth = new GmailAuth();
      const auth = await gmailAuth.loadCredentials();
      
      taskProcessor = new TaskProcessor(agente, mcpClient);
      await taskProcessor.initGmail(auth);
      await taskProcessor.startProcessing(req.body.interval || 5);

      res.json({ status: 'started', interval: req.body.interval || 5 });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/tasks/stop', (req, res) => {
    if (taskProcessor) {
      taskProcessor.stopProcessing();
    }
    res.json({ status: 'stopped' });
  });

  app.get('/tasks/history', async (req, res) => {
    try {
      const processor = new TaskProcessor(agente, mcpClient);
      const history = await processor.loadHistory();
      res.json({ history });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n👋 Desconectando...');
    if (mcpClient) {
      try {
        await mcpClient.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
    process.exit(0);
  });

  app.listen(port, () => {
    console.log(`🚀 Agente Luis escuchando en http://localhost:${port}`);
    console.log(`   POST /chat        - Enviar mensajes`);
    console.log(`   GET /health       - Verificar estado`);
    console.log(`   POST /reset       - Limpiar sesiones`);
    console.log(`   GET /gmail/auth   - URL autenticación Gmail`);
    console.log(`   POST /tasks/start - Iniciar procesador de tareas`);
    console.log(`   POST /tasks/stop  - Detener procesador`);
    console.log(`   GET /tasks/history - Historial de ejecuciones`);
  });
}
