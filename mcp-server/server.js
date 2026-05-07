import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';

const app = express();

// Servidor MCP de ejemplo con herramientas útiles
const server = new Server(
  { name: 'mcp-server-luis', version: '1.0.0' },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Definir herramientas
server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: 'calcular',
        description: 'Realiza operaciones matemáticas básicas',
        inputSchema: {
          type: 'object',
          properties: {
            operacion: {
              type: 'string',
              enum: ['sumar', 'restar', 'multiplicar', 'dividir'],
              description: 'Operación a realizar'
            },
            a: { type: 'number', description: 'Primer número' },
            b: { type: 'number', description: 'Segundo número' }
          },
          required: ['operacion', 'a', 'b']
        }
      },
      {
        name: 'buscar_info',
        description: 'Busca información sobre un tema (simulado)',
        inputSchema: {
          type: 'object',
          properties: {
            tema: {
              type: 'string',
              description: 'Tema a buscar'
            }
          },
          required: ['tema']
        }
      },
      {
        name: 'hora_actual',
        description: 'Obtiene la hora actual del servidor',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Ejecutar herramientas
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'calcular': {
      const { operacion, a, b } = args;
      let resultado;
      switch (operacion) {
        case 'sumar': resultado = a + b; break;
        case 'restar': resultado = a - b; break;
        case 'multiplicar': resultado = a * b; break;
        case 'dividir': 
          if (b === 0) throw new Error('División por cero');
          resultado = a / b; 
          break;
      }
      return {
        content: [{ type: 'text', text: `Resultado: ${resultado}` }]
      };
    }

    case 'buscar_info': {
      const { tema } = args;
      return {
        content: [{ 
          type: 'text', 
          text: `Información sobre "${tema}": Este es un resultado simulado. En producción, aquí conectarías con una API real, base de datos, o servicio de búsqueda.` 
        }]
      };
    }

    case 'hora_actual': {
      return {
        content: [{ 
          type: 'text', 
          text: `Hora actual: ${new Date().toISOString()}` 
        }]
      };
    }

    default:
      throw new Error(`Herramienta desconocida: ${name}`);
  }
});

// SSE endpoint
let transport = null;

app.get('/sse', async (req, res) => {
  transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  }
});

const PORT = process.env.MCP_PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔌 MCP Server escuchando en http://localhost:${PORT}`);
  console.log(`   SSE: /sse`);
  console.log(`   Mensajes: /messages`);
});
