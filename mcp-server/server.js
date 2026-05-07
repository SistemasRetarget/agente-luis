import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_PATH = path.join(process.cwd(), 'PROJECTS', 'REGISTRY.json');

const app = express();

// Servidor MCP con habilidades de Retarget Agency
const server = new Server(
  { name: 'retarget-mcp-server', version: '2.0.0' },
  {
    capabilities: {
      tools: {}
    }
  }
);

// ==================== HABILIDADES RETARGET ====================

async function loadRegistry() {
  try {
    const content = await fs.readFile(PROJECTS_PATH, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    return { projects: {} };
  }
}

async function verifyUrl(url, timeout = 8000) {
  if (!url || url === 'PENDIENTE') return { ok: false, status: 0 };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(url, { 
      method: 'HEAD',
      signal: controller.signal 
    });
    clearTimeout(timeoutId);
    
    return { ok: response.status === 200, status: response.status };
  } catch (e) {
    try {
      const response = await fetch(url, { timeout });
      return { ok: response.status === 200, status: response.status };
    } catch (e2) {
      return { ok: false, status: 0, error: e2.message };
    }
  }
}

async function validateCoreWebVitals(url, apiKey) {
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile${apiKey ? '&key=' + apiKey : ''}`;
  
  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    
    if (!data.lighthouseResult) {
      return { passed: false, error: 'No se pudo obtener resultados de PageSpeed' };
    }
    
    const audits = data.lighthouseResult.audits;
    const metrics = {
      lcp: audits['largest-contentful-paint']?.numericValue / 1000,
      fid: audits['max-potential-fid']?.numericValue,
      cls: audits['cumulative-layout-shift']?.numericValue,
      ttfb: audits['server-response-time']?.numericValue
    };
    
    const passed = metrics.lcp <= 2.5 && metrics.fid <= 100 && metrics.cls <= 0.1;
    
    return {
      passed,
      metrics,
      score: data.lighthouseResult.categories?.performance?.score * 100 || 0,
      issues: passed ? [] : ['Core Web Vitals no cumplen estándares']
    };
  } catch (e) {
    return { passed: false, error: e.message };
  }
}

async function validateGoogleAdsPolicies(url) {
  const issues = [];
  const checks = {};
  
  try {
    const response = await fetch(url, { timeout: 10000 });
    const html = await response.text();
    
    // Check 1: Contact info present
    checks.contact_info = /contacto|teléfono|email|@/i.test(html);
    if (!checks.contact_info) issues.push('Falta información de contacto visible');
    
    // Check 2: Privacy policy
    checks.privacy_policy = /política.*privacidad|privacy.*policy/i.test(html);
    if (!checks.privacy_policy) issues.push('Falta política de privacidad');
    
    // Check 3: No misleading claims
    checks.no_misleading = !/(garantizado|100%|siempre|nunca falla)/i.test(html);
    if (!checks.no_misleading) issues.push('Posibles afirmaciones engañosas detectadas');
    
    // Check 4: Loading speed
    checks.loading_speed = html.length < 500000; // Under 500KB
    if (!checks.loading_speed) issues.push('Página muy pesada, puede afectar Quality Score');
    
    const passed = Object.values(checks).every(Boolean);
    
    return { passed, checks, issues, warnings: [] };
  } catch (e) {
    return { passed: false, error: e.message, checks: {}, issues: [e.message] };
  }
}

async function validateSEOTechnical(url) {
  const issues = [];
  const recommendations = [];
  
  try {
    const response = await fetch(url, { timeout: 10000 });
    const html = await response.text();
    
    // Check title
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    const hasTitle = titleMatch && titleMatch[1].length > 10;
    if (!hasTitle) issues.push('Falta title tag o es muy corto');
    
    // Check meta description
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
    const hasMetaDesc = descMatch && descMatch[1].length > 50;
    if (!hasMetaDesc) issues.push('Falta meta description o es muy corta');
    
    // Check h1
    const h1Match = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
    const hasH1 = h1Match && h1Match[1].length > 0;
    if (!hasH1) issues.push('Falta H1');
    
    // Check canonical
    const hasCanonical = html.match(/<link[^>]*rel="canonical"/i);
    if (!hasCanonical) recommendations.push('Agregar tag canonical');
    
    // Check images alt
    const imgTags = html.match(/<img[^>]*>/gi) || [];
    const imgWithoutAlt = imgTags.filter(img => !img.includes('alt=')).length;
    if (imgWithoutAlt > 0) recommendations.push(`${imgWithoutAlt} imágenes sin atributo alt`);
    
    // Check viewport
    const hasViewport = html.match(/<meta[^>]*name="viewport"/i);
    if (!hasViewport) issues.push('Falta viewport meta tag (no es mobile-friendly)');
    
    const score = Math.max(0, 100 - (issues.length * 15) - (recommendations.length * 5));
    
    return { 
      passed: issues.length === 0, 
      score, 
      issues, 
      recommendations,
      checks: { hasTitle, hasMetaDesc, hasH1, hasCanonical, hasViewport }
    };
  } catch (e) {
    return { passed: false, error: e.message, issues: [e.message], score: 0 };
  }
}

async function validateMobileFirst(url) {
  const issues = [];
  const recommendations = [];
  
  try {
    const response = await fetch(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)' },
      timeout: 10000 
    });
    const html = await response.text();
    
    // Check responsive meta
    const hasViewport = html.match(/<meta[^>]*name="viewport"/i);
    if (!hasViewport) issues.push('No tiene viewport configurado');
    
    // Check media queries
    const hasMediaQueries = html.match(/@media\s*\(/i);
    if (!hasMediaQueries) recommendations.push('Agregar media queries para responsive');
    
    // Check touch targets
    const smallButtons = (html.match(/<button[^>]*>/gi) || []).length;
    if (smallButtons > 0) recommendations.push('Verificar que botones sean fáciles de tocar (44x44px mínimo)');
    
    // Check font sizes
    const hasSmallFonts = html.match(/font-size:\s*\d+px/i);
    if (hasSmallFonts) {
      const sizes = html.match(/font-size:\s*(\d+)px/gi) || [];
      const smallSizes = sizes.filter(s => parseInt(s.match(/\d+/)[0]) < 14);
      if (smallSizes.length > 0) issues.push('Textos muy pequeños para móvil detectados');
    }
    
    const score = Math.max(0, 100 - (issues.length * 20) - (recommendations.length * 5));
    
    return {
      passed: issues.length === 0,
      score,
      issues,
      recommendations,
      mobile_first_compliant: issues.length === 0
    };
  } catch (e) {
    return { passed: false, error: e.message, mobile_first_compliant: false, score: 0 };
  }
}

// ==================== TOOLS MCP ====================

server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: 'validar_website_completo',
        description: 'Validación completa de sitio web: Core Web Vitals, Google Ads policies, SEO técnico, y Mobile First',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL del sitio a validar' },
            strategy: { type: 'string', enum: ['mobile', 'desktop'], default: 'mobile' }
          },
          required: ['url']
        }
      },
      {
        name: 'validar_core_web_vitals',
        description: 'Valida métricas Core Web Vitals (LCP, FID, CLS) usando PageSpeed API',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL a validar' },
            api_key: { type: 'string', description: 'Google PageSpeed API key (opcional)' }
          },
          required: ['url']
        }
      },
      {
        name: 'validar_google_ads_policies',
        description: 'Verifica cumplimiento de políticas Google Ads para landing pages',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL de la landing page' }
          },
          required: ['url']
        }
      },
      {
        name: 'validar_seo_tecnico',
        description: 'Valida SEO técnico: títulos, meta descriptions, H1, canonical, alt tags',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL a analizar' }
          },
          required: ['url']
        }
      },
      {
        name: 'validar_mobile_first',
        description: 'Valida responsive design y mobile-first approach',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL a validar' }
          },
          required: ['url']
        }
      },
      {
        name: 'validar_proyecto_registry',
        description: 'Valida un proyecto contra el REGISTRY.json de Retarget',
        inputSchema: {
          type: 'object',
          properties: {
            project_key: { type: 'string', description: 'Key del proyecto en REGISTRY' }
          },
          required: ['project_key']
        }
      },
      {
        name: 'verificar_url_activa',
        description: 'Verifica que una URL responde HTTP 200',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL a verificar' },
            timeout: { type: 'number', description: 'Timeout en ms', default: 8000 }
          },
          required: ['url']
        }
      },
      {
        name: 'deploy',
        description: 'Realiza deploy de un proyecto a Cloud Run',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Nombre del proyecto' },
            environment: { type: 'string', enum: ['qa', 'production'], default: 'qa' }
          },
          required: ['project']
        }
      }
    ]
  };
});

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'validar_website_completo': {
      const { url, strategy = 'mobile' } = args;
      const results = {
        url,
        passed: true,
        overall_score: 0,
        core_web_vitals: {},
        google_ads_policies: {},
        seo_technical: {},
        mobile_first: {},
        issues: [],
        recommendations: []
      };
      
      // Ejecutar todas las validaciones
      const cwv = await validateCoreWebVitals(url, process.env.PAGESPEED_API_KEY);
      results.core_web_vitals = cwv;
      if (!cwv.passed) results.passed = false;
      if (cwv.issues) results.issues.push(...cwv.issues);
      
      const ads = await validateGoogleAdsPolicies(url);
      results.google_ads_policies = ads;
      if (!ads.passed) results.passed = false;
      if (ads.issues) results.issues.push(...ads.issues);
      if (ads.warnings) results.recommendations.push(...ads.warnings);
      
      const seo = await validateSEOTechnical(url);
      results.seo_tecnico = seo;
      if (!seo.passed) results.passed = false;
      if (seo.issues) results.issues.push(...seo.issues);
      if (seo.recommendations) results.recommendations.push(...seo.recommendations);
      
      const mobile = await validateMobileFirst(url);
      results.mobile_first = mobile;
      if (!mobile.passed) results.passed = false;
      if (mobile.issues) results.issues.push(...mobile.issues);
      if (mobile.recommendations) results.recommendations.push(...mobile.recommendations);
      
      // Calcular score general
      const scores = [
        (cwv.score || 0) * 0.25,
        (seo.score || 0) * 0.25,
        (mobile.score || 0) * 0.25,
        (ads.passed ? 100 : 0) * 0.25
      ];
      results.overall_score = Math.round(scores.reduce((a, b) => a + b, 0));
      
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }

    case 'validar_core_web_vitals': {
      const result = await validateCoreWebVitals(args.url, args.api_key || process.env.PAGESPEED_API_KEY);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'validar_google_ads_policies': {
      const result = await validateGoogleAdsPolicies(args.url);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'validar_seo_tecnico': {
      const result = await validateSEOTechnical(args.url);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'validar_mobile_first': {
      const result = await validateMobileFirst(args.url);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'validar_proyecto_registry': {
      const registry = await loadRegistry();
      const project = registry.projects?.[args.project_key];
      
      if (!project) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Proyecto '${args.project_key}' no existe` }, null, 2) }] };
      }
      
      const errors = [];
      const warnings = [];
      const required = ['url_production', 'url_qa', 'service_name_cloudrun', 'repo'];
      
      for (const field of required) {
        if (!project[field] || project[field] === 'PENDIENTE') {
          errors.push(`Campo '${field}' faltante o PENDIENTE`);
        }
      }
      
      // Verificar URLs
      for (const urlKey of ['url_production', 'url_qa']) {
        const url = project[urlKey];
        if (url && url !== 'PENDIENTE') {
          const check = await verifyUrl(url);
          if (!check.ok) {
            errors.push(`${urlKey} (${url}) devuelve ${check.status || 'error'}`);
          }
        }
      }
      
      return { content: [{ type: 'text', text: JSON.stringify({ 
        ok: errors.length === 0,
        project: project.name || args.project_key,
        errors,
        warnings,
        data: project
      }, null, 2) }] };
    }

    case 'verificar_url_activa': {
      const result = await verifyUrl(args.url, args.timeout);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'deploy': {
      // En producción, esto conectaría con Cloud Build/Cloud Run
      return { content: [{ type: 'text', text: JSON.stringify({
        status: 'triggered',
        project: args.project,
        environment: args.environment || 'qa',
        message: `Deploy de ${args.project} a ${args.environment} iniciado`,
        note: 'En producción, esto ejecutaría gcloud builds submit'
      }, null, 2) }] };
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
  console.log('🔌 MCP Server Retarget escuchando en http://localhost:' + PORT);
  console.log('   Habilidades disponibles:');
  console.log('   - validar_website_completo');
  console.log('   - validar_core_web_vitals');
  console.log('   - validar_google_ads_policies');
  console.log('   - validar_seo_tecnico');
  console.log('   - validar_mobile_first');
  console.log('   - validar_proyecto_registry');
  console.log('   - verificar_url_activa');
  console.log('   - deploy');
});
ENDOFFILE 2>&1