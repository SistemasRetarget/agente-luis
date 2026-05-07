# Agente Luis 🤖

Agente inteligente que conecta Claude (Anthropic API) con servidores MCP (Model Context Protocol).

## Arquitectura

```
┌─────────────┐     HTTP      ┌──────────────┐     SSE/stdio     ┌─────────────┐
│   Cliente   │ ───────────> │  Agente Luis │ ─────────────────> │ MCP Server  │
│  (curl/app) │              │  (Claude SDK)│                    │(Herramientas)│
└─────────────┘              └──────────────┘                    └─────────────┘
```

## Requisitos

- Node.js 18+
- API Key de Anthropic ([obtener aquí](https://console.anthropic.com/))

## Instalación

```bash
cd agente-luis
npm install
cp .env.example .env
# Editar .env con tu ANTHROPIC_API_KEY
```

## Uso

### 1. Iniciar MCP Server (en una terminal)
```bash
npm run mcp-server
# Escucha en http://localhost:3001
```

### 2. Iniciar Agente Luis (en otra terminal)
```bash
npm run dev
# Escucha en http://localhost:3000
```

### 3. Probar el agente
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"mensaje": "Cuánto es 25 * 4?"}'
```

## API Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/chat` | POST | Enviar mensaje al agente |
| `/health` | GET | Verificar estado |
| `/reset` | POST | Limpiar sesión |
| `/gmail/auth` | GET | Obtener URL de autenticación Gmail |
| `/tasks/start` | POST | Iniciar procesador de tareas |
| `/tasks/stop` | POST | Detener procesador |
| `/tasks/history` | GET | Ver historial de tareas ejecutadas |
| `/supervisor/report` | POST | Generar reporte para supervisor |

## Procesador de Tareas (Auto-Administración)

El agente puede leer emails de `sistemas@retarget.cl` con asunto `[TAREA]` o `[TASK]` y ejecutarlas automáticamente:

### 1. Configurar Gmail OAuth
- Crear proyecto en [Google Cloud Console](https://console.cloud.google.com/)
- Habilitar Gmail API
- Crear credenciales OAuth2 (Desktop app)
- Agregar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` al `.env`

### 2. Autenticar
```bash
curl http://localhost:3000/gmail/auth
# Abrir URL en navegador y autorizar
```

### 3. Iniciar procesador
```bash
curl -X POST http://localhost:3000/tasks/start \
  -H "Content-Type: application/json" \
  -d '{"interval": 5}'
```

### 4. Enviar tareas por email
Enviar email a `sistemas@retarget.cl` con:
- **Asunto:** `[TAREA] Deploy sitio Puyehue`
- **Contenido:** Descripción de la acción a realizar

El agente:
1. Lee el email cada 5 minutos
2. Parsea la tarea con Claude
3. Ejecuta usando herramientas MCP
4. Guarda historial en `data/tasks.json`
5. Marca email como leído si fue exitoso

## Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | API key de Claude | - |
| `MCP_SERVER_URL` | URL del servidor MCP (SSE) | - |
| `MCP_SERVER_COMMAND` | Comando para MCP local | - |
| `PORT` | Puerto del agente | 3000 |
| `CLAUDE_MODEL` | Modelo Claude | claude-3-5-sonnet-20241022 |
| `GITHUB_TOKEN` | Token GitHub (para supervisor) | - |
| `GOOGLE_CLIENT_ID` | Gmail OAuth Client ID | - |
| `GOOGLE_CLIENT_SECRET` | Gmail OAuth Secret | - |

## Supervisor Mode

El agente puede reportar al supervisor vía GitHub:

```bash
# Ver issues del repo
curl -X POST http://localhost:3000/chat \
  -d '{"mensaje": "Lista los issues abiertos de SistemasRetarget/agente-luis"}'

# Crear issue para reportar
curl -X POST http://localhost:3000/chat \
  -d '{"mensaje": "Crea issue en GitHub: Título 'Bug en deploy', Cuerpo 'El servicio no inicia'"}'

# Generar reporte de trabajo
curl -X POST http://localhost:3000/supervisor/report \
  -d '{"session_id": "default", "include_tasks": true}'
```

## Despliegue en la nube

### Railway (recomendado)
```bash
railway login
railway init
railway up
```

### Fly.io
```bash
fly launch
fly deploy
```

## Personalizar herramientas MCP

Edita `mcp-server/server.js` para agregar nuevas herramientas. El agente las detecta automáticamente.
