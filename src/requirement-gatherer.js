import { google } from 'googleapis';

export class RequirementGatherer {
  constructor(agente, gmail) {
    this.agente = agente;
    this.gmail = gmail;
    this.conversations = new Map(); // emailId -> conversation state
  }

  // Analiza requerimiento y determina si necesita más información
  async analyzeRequirement(email) {
    const prompt = `Eres un asistente de sistemas que analiza requerimientos de clientes.

REQUERIMIENTO RECIBIDO:
De: ${email.from}
Asunto: ${email.subject}
Contenido: ${email.body}

Analiza si el requerimiento está CLARO o NECESITA CLARIFICACIÓN:

Si está CLARO:
- Todas las acciones especificadas son entendibles
- Se sabe qué cliente/proyecto es
- Se sabe qué cambiar/desplegar/configurar
- No hay ambigüedades

Si NECESITA CLARIFICACIÓN:
- No está claro qué hacer exactamente
- Falta información sobre el cliente/proyecto
- No se sabe qué archivos/configuración cambiar
- Hay múltiples interpretaciones posibles

Responde SOLO en JSON:
{
  "is_clear": true/false,
  "confidence": 0-100,
  "missing_info": ["info faltante 1", "info faltante 2"],
  "questions": ["pregunta 1?", "pregunta 2?"],
  "suggested_action": "acción sugerida si está claro"
}`;

    const result = await this.agente.procesarMensaje(prompt, []);
    
    try {
      const jsonMatch = result.respuesta.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Error parseando análisis:', e);
    }

    return { is_clear: true, confidence: 50 };
  }

  // Genera respuesta con preguntas de clarificación
  async generateClarificationResponse(email, analysis) {
    const prompt = `Eres un asistente de sistemas respondiendo a un cliente por email.

REQUERIMIENTO ORIGINAL:
De: ${email.from}
Asunto: ${email.subject}
Contenido: ${email.body}

ANÁLISIS:
- El requerimiento necesita clarificación
- Información faltante: ${analysis.missing_info.join(', ')}
- Preguntas: ${analysis.questions.join(', ')}

Genera una respuesta profesional y útil que:
1. Confirma que recibimos el requerimiento
2. Pregunta las preguntas de clarificación de forma natural
3. Ofrece ayuda adicional
4. Usa tono profesional pero cercano

Responde SOLO con el cuerpo del email (sin asunto, sin saludos excesivos):`;

    const result = await this.agente.procesarMensaje(prompt, []);
    return result.respuesta.trim();
  }

  // Envía respuesta por Gmail
  async sendReply(originalEmail, replyBody) {
    if (!this.gmail) {
      console.warn('Gmail no configurado, no se puede enviar respuesta');
      return null;
    }

    try {
      // Crear mensaje MIME
      const message = [
        `To: ${originalEmail.from}`,
        `Subject: Re: ${originalEmail.subject}`,
        '',
        replyBody
      ].join('\r\n');

      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const result = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
          threadId: originalEmail.threadId
        }
      });

      return result.data;
    } catch (error) {
      console.error('Error enviando respuesta:', error);
      return null;
    }
  }

  // Workflow principal: analiza, pregunta si es necesario, o pasa a ejecutar
  async processEmail(email) {
    // Verificar si hay conversación previa
    const conversation = this.conversations.get(email.threadId);
    
    if (conversation && conversation.status === 'waiting_for_response') {
      // El cliente respondió, analizar respuestas
      return await this.handleFollowUp(email, conversation);
    }

    // Primera interacción
    const analysis = await this.analyzeRequirement(email);

    if (!analysis.is_clear && analysis.questions.length > 0) {
      // Necesita clarificación - enviar preguntas
      const replyBody = await this.generateClarificationResponse(email, analysis);
      
      await this.sendReply(email, replyBody);

      // Guardar estado de conversación
      this.conversations.set(email.threadId, {
        status: 'waiting_for_response',
        originalEmail: email,
        analysis: analysis,
        questionsAsked: analysis.questions,
        createdAt: new Date().toISOString()
      });

      return {
        action: 'clarifying',
        questions: analysis.questions,
        status: 'waiting_for_response'
      };
    }

    // Requerimiento claro - pasar a ejecución
    return {
      action: 'execute',
      is_clear: true,
      suggested_action: analysis.suggested_action,
      originalEmail: email
    };
  }

  // Maneja respuestas del cliente
  async handleFollowUp(email, conversation) {
    const prompt = `Eres un asistente de sistemas analizando respuestas del cliente.

REQUERIMIENTO ORIGINAL:
${conversation.originalEmail.body}

PREGUNTAS HECHAS:
${conversation.questionsAsked.join('\n')}

RESPUESTA DEL CLIENTE:
${email.body}

Determina si ahora el requerimiento está CLARO para ejecutar o aún NECESITA MÁS INFO.

Responde SOLO en JSON:
{
  "is_clear": true/false,
  "parsed_requirement": "requerimiento parseado completo",
  "new_questions": ["nuevas preguntas si aún no está claro"],
  "project": "nombre del proyecto",
  "action": "tipo de acción",
  "details": "detalles"
}`;

    const result = await this.agente.procesarMensaje(prompt, []);
    
    try {
      const jsonMatch = result.respuesta.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);

        if (!analysis.is_clear && analysis.new_questions.length > 0) {
          // Aún necesita más info
          const replyBody = await this.generateClarificationResponse(email, {
            questions: analysis.new_questions,
            missing_info: []
          });
          
          await this.sendReply(email, replyBody);

          return {
            action: 'clarifying',
            questions: analysis.new_questions,
            status: 'waiting_for_response'
          };
        }

        // Ahora está claro - limpiar conversación y pasar a ejecutar
        this.conversations.delete(email.threadId);

        return {
          action: 'execute',
          parsed: analysis,
          originalEmail: email
        };
      }
    } catch (e) {
      console.error('Error parseando respuesta:', e);
    }

    return { action: 'error', error: 'No se pudo parsear respuesta' };
  }

  // Limpiar conversaciones viejas (> 24 horas)
  cleanupOldConversations() {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    for (const [threadId, conversation] of this.conversations.entries()) {
      const createdAt = new Date(conversation.createdAt).getTime();
      if (createdAt < oneDayAgo) {
        this.conversations.delete(threadId);
      }
    }
  }
}
