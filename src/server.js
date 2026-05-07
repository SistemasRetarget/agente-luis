import express from 'express';
import { MCPClient } from './mcp-client.js';
import { AgenteLuis } from './agent.js';

const app = express();
app.use(express.json());

let mcpClient = null;
let agente = null;
const sessions = new Map();

export async function startServer(port) {
  // Conectar a MCP al iniciar
  mcpClient = new MCPClient();
  await mcpClient.connect();
  
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
      herramientas: mcpClient?.tools?.length || 0
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

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n👋 Desconectando...');
    await mcpClient.disconnect();
    process.exit(0);
  });

  app.listen(port, () => {
    console.log(`🚀 Agente Luis escuchando en http://localhost:${port}`);
    console.log(`   POST /chat - Enviar mensajes`);
    console.log(`   GET /health - Verificar estado`);
    console.log(`   POST /reset - Limpiar sesiones`);
  });
}
