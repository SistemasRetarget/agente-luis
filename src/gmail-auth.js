import { google } from 'googleapis';
import { promises as fs } from 'fs';
import path from 'path';
import { createServer } from 'http';
import { parse } from 'url';

const TOKEN_PATH = path.join(process.cwd(), 'data', 'gmail-token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'data', 'credentials.json');

export class GmailAuth {
  constructor() {
    this.oAuth2Client = null;
  }

  async loadCredentials() {
    // Intentar cargar desde archivo o variables de entorno
    let credentials;
    
    try {
      const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
      credentials = JSON.parse(content);
    } catch (e) {
      // Usar variables de entorno
      if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        credentials = {
          installed: {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uris: ['http://localhost:3000/oauth2callback']
          }
        };
      } else {
        throw new Error('No hay credenciales de Google. Configura GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET o pon credentials.json en data/');
      }
    }

    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
    
    this.oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    // Cargar token existente si hay
    try {
      const token = await fs.readFile(TOKEN_PATH, 'utf8');
      this.oAuth2Client.setCredentials(JSON.parse(token));
      console.log('✅ Token Gmail cargado');
    } catch (e) {
      console.log('⚠️ No hay token Gmail guardado, se requiere autenticación');
    }

    return this.oAuth2Client;
  }

  async getAuthUrl() {
    if (!this.oAuth2Client) await this.loadCredentials();
    
    const authUrl = this.oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify'
      ]
    });

    return authUrl;
  }

  async saveToken(code) {
    if (!this.oAuth2Client) await this.loadCredentials();
    
    const { tokens } = await this.oAuth2Client.getToken(code);
    this.oAuth2Client.setCredentials(tokens);
    
    await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true });
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    
    console.log('✅ Token Gmail guardado');
    return tokens;
  }

  getAuth() {
    return this.oAuth2Client;
  }
}
