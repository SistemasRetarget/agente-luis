import 'dotenv/config';
import { startServer } from './server.js';

const PORT = process.env.PORT || 3000;

console.log('🚀 Iniciando Agente Luis...');
startServer(PORT);
