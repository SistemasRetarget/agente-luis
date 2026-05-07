import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class MCPClient {
  constructor() {
    this.client = null;
    this.transport = null;
    this.tools = [];
  }

  async connect() {
    const serverUrl = process.env.MCP_SERVER_URL;
    const command = process.env.MCP_SERVER_COMMAND;

    if (serverUrl) {
      // Conexión remota via SSE
      this.transport = new SSEClientTransport(new URL(serverUrl));
    } else if (command) {
      // Conexión local via stdio
      const args = process.env.MCP_SERVER_ARGS?.split(' ') || [];
      this.transport = new StdioClientTransport({ command, args });
    } else {
      throw new Error('Debes configurar MCP_SERVER_URL o MCP_SERVER_COMMAND');
    }

    this.client = new Client({ name: 'agente-luis', version: '1.0.0' });
    await this.client.connect(this.transport);

    // Listar herramientas disponibles
    const toolsResult = await this.client.listTools();
    this.tools = toolsResult.tools || [];

    console.log(`✅ Conectado a MCP. ${this.tools.length} herramientas disponibles:`);
    this.tools.forEach(t => console.log(`   - ${t.name}: ${t.description}`));

    return this.tools;
  }

  async callTool(name, args) {
    if (!this.client) throw new Error('MCP no conectado');
    
    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  getToolsForClaude() {
    return this.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));
  }

  async disconnect() {
    if (this.transport) {
      await this.transport.close();
    }
  }
}
