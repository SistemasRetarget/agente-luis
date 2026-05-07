import Anthropic from '@anthropic-ai/sdk';

export class AgenteLuis {
  constructor(mcpClient) {
    this.mcp = mcpClient;
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    this.model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
  }

  async procesarMensaje(mensaje, historial = []) {
    const tools = this.mcp ? this.mcp.getToolsForClaude() : [];
    
    const messages = [
      ...historial,
      { role: 'user', content: mensaje }
    ];

    // Primera llamada a Claude con herramientas disponibles
    let response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages,
      tools: tools.length > 0 ? tools : undefined
    });

    // Procesar loop de herramientas
    while (response.stop_reason === 'tool_use') {
      const toolUse = response.content.find(c => c.type === 'tool_use');
      
      if (toolUse) {
        console.log(`🔧 Ejecutando herramienta: ${toolUse.name}`);
        
        // Ejecutar herramienta via MCP (si está disponible)
        let toolResult;
        if (this.mcp) {
          toolResult = await this.mcp.callTool(toolUse.name, toolUse.input);
        } else {
          toolResult = { error: 'MCP no disponible', simulated: true };
        }

        // Agregar respuesta de Claude al historial
        messages.push({
          role: 'assistant',
          content: response.content
        });

        // Agregar resultado de la herramienta
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(toolResult)
          }]
        });

        // Siguiente llamada a Claude
        response = await this.anthropic.messages.create({
          model: this.model,
          max_tokens: 4096,
          messages,
          tools: tools.length > 0 ? tools : undefined
        });
      }
    }

    // Extraer texto de la respuesta final
    const texto = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    return {
      respuesta: texto,
      historial: messages.concat([{
        role: 'assistant',
        content: response.content
      }])
    };
  }
}
