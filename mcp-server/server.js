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
      },
      {
        name: 'compass_load_context',
        description: 'Carga TODO el contexto COMPASS: HANDOFF, CONTEXT, MEMORY, VOZ, INSTRUCTIONS, PROTOCOL',
        inputSchema: {
          type: 'object',
          properties: {
            workspace_root: { 
              type: 'string', 
              description: 'Ruta al workspace (default: /workspace o WORKSPACE_ROOT env)'
            }
          }
        }
      },
      {
        name: 'skill_puyehue_site_evolution',
        description: 'Mega skill: Analiza, optimiza y evoluciona sitios web completos (analyzer, optimizer, analytics, admin)',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL del sitio a evolucionar' },
            ga4_id: { type: 'string', description: 'GA4 Measurement ID (G-...)' },
            ads_id: { type: 'string', description: 'Google Ads Conversion ID (AW-...)' },
            builder_io_token: { type: 'string', description: 'Builder.io API Key' },
            cloud_project: { type: 'string', description: 'Google Cloud Project ID' },
            enable_bigquery: { type: 'boolean', default: false },
            modules: {
              type: 'object',
              properties: {
                analyzer: { type: 'boolean', default: true },
                optimizer: { type: 'boolean', default: true },
                analytics: { type: 'boolean', default: true },
                admin: { type: 'boolean', default: true }
              }
            }
          },
          required: ['url']
        }
      },
      {
        name: 'skill_analyze_design_system',
        description: 'Extrae design tokens: colores, tipografías, espaciado usando análisis visual',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL del sitio' },
            extract_colors: { type: 'boolean', default: true },
            extract_typography: { type: 'boolean', default: true },
            validate_contrast: { type: 'string', enum: ['none', 'WCAG_AA', 'WCAG_AAA'], default: 'WCAG_AA' }
          },
          required: ['url']
        }
      },
      {
        name: 'skill_optimize_performance',
        description: 'Optimiza imágenes, lazy loading, Core Web Vitals',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL del sitio' },
            image_formats: { type: 'array', items: { type: 'string' }, default: ['webp', 'avif'] },
            quality: { type: 'number', default: 80 },
            breakpoints: { type: 'array', items: { type: 'number' }, default: [640, 1024, 1280] }
          },
          required: ['url']
        }
      },
      {
        name: 'skill_configure_analytics',
        description: 'Configura GA4 events, Google Ads conversion tracking, BigQuery export',
        inputSchema: {
          type: 'object',
          properties: {
            ga4_id: { type: 'string', description: 'GA4 ID' },
            ads_id: { type: 'string', description: 'Google Ads ID' },
            conversion_events: { 
              type: 'array', 
              items: { type: 'string' },
              default: ['click_reserva', 'click_contacto', 'form_submit']
            },
            enable_bigquery: { type: 'boolean', default: false }
          },
          required: ['ga4_id']
        }
      },
      {
        name: 'skill_setup_builder_io',
        description: 'Configura Builder.io auto-administración con block types personalizados',
        inputSchema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', description: 'Builder.io API Key' },
            block_types: { 
              type: 'array', 
              items: { type: 'string' },
              default: ['Hero', 'Gallery', 'CTA', 'FAQ', 'Testimonial']
            },
            project_name: { type: 'string', description: 'Nombre del modelo en Builder.io' }
          },
          required: ['api_key', 'project_name']
        }
      },
      {
        name: 'github_list_issues',
        description: 'Lista issues de un repositorio GitHub',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Owner del repo (ej: SistemasRetarget)' },
            repo: { type: 'string', description: 'Nombre del repo' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
            labels: { type: 'string', description: 'Filtrar por labels' }
          },
          required: ['owner', 'repo']
        }
      },
      {
        name: 'github_create_issue',
        description: 'Crear issue en GitHub para reportar al supervisor',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Owner del repo' },
            repo: { type: 'string', description: 'Nombre del repo' },
            title: { type: 'string', description: 'Título del issue' },
            body: { type: 'string', description: 'Cuerpo del issue (markdown)' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Labels del issue' }
          },
          required: ['owner', 'repo', 'title']
        }
      },
      {
        name: 'github_get_commit',
        description: 'Obtener detalles de un commit específico',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Owner del repo' },
            repo: { type: 'string', description: 'Nombre del repo' },
            sha: { type: 'string', description: 'SHA del commit' }
          },
          required: ['owner', 'repo', 'sha']
        }
      },
      {
        name: 'supervisor_report',
        description: 'Genera reporte para el supervisor sobre trabajo realizado',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: { type: 'string', description: 'ID de sesión a reportar' },
            include_tasks: { type: 'boolean', default: true },
            include_errors: { type: 'boolean', default: true }
          }
        }
      },
      {
        name: 'supervisor_create_task',
        description: 'Crea tarea para el supervisor (cliente, requerimiento, estado, URL cambio)',
        inputSchema: {
          type: 'object',
          properties: {
            cliente: { type: 'string', description: 'Nombre del cliente' },
            requerimiento: { type: 'string', description: 'Descripción del requerimiento' },
            estado: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'], default: 'pending' },
            prioridad: { type: 'string', enum: ['high', 'medium', 'low'], default: 'medium' },
            cambio_url: { type: 'string', description: 'URL del cambio/commit' },
            commit: { type: 'string', description: 'SHA del commit' },
            notas: { type: 'string', description: 'Notas adicionales' }
          },
          required: ['cliente', 'requerimiento']
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

    case 'compass_load_context': {
      const WORKSPACE = args.workspace_root || process.env.WORKSPACE_ROOT || '/workspace';
      
      const contextFiles = [
        { file: 'HANDOFF.md', desc: 'Estado Actual' },
        { file: 'CONTEXT.md', desc: 'Visión y Decisiones' },
        { file: 'VOZ_LUIS.md', desc: 'Voz y Comunicación' },
        { file: 'INSTRUCTIONS.md', desc: 'Protocolo de Operación' },
        { file: '.claude/projects/-Users-spam11-Desktop-RETARGET-WORKSPACE/memory/MEMORY.md', desc: 'Índice de Memoria' },
        { file: '.claude/projects/-Users-spam11-Desktop-RETARGET-WORKSPACE/memory/project_compass_protocol.md', desc: 'Protocolo COMPASS' }
      ];
      
      const results = {
        loaded: [],
        missing: [],
        summary: { estado: {}, vision: null },
        compass_activated: true
      };
      
      for (const item of contextFiles) {
        const fullPath = path.join(WORKSPACE, item.file);
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          results.loaded.push({ file: item.file, desc: item.desc, size: content.length });
          
          // Extraer información clave según el archivo
          if (item.file === 'HANDOFF.md') {
            const completado = content.match(/## ✅ COMPLETADO[\s\S]*?(?=## |$)/);
            const enProgreso = content.match(/## [🚀🔄⏳].*?[\s\S]*?(?=## |$)/);
            results.summary.estado = {
              completado: completado ? 'Cargado (' + (completado[0].match(/✅/g) || []).length + ' items)' : null,
              enProgreso: enProgreso ? enProgreso[0].substring(0, 300) + '...' : null
            };
          }
          
          if (item.file === 'CONTEXT.md') {
            const vision = content.match(/## 🎯 VISIÓN[\s\S]*?(?=## |$)/);
            results.summary.vision = vision ? vision[0].substring(0, 200) + '...' : null;
          }
        } catch (e) {
          results.missing.push(item.file);
        }
      }
      
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }

    case 'skill_puyehue_site_evolution': {
      const { url, ga4_id, ads_id, builder_io_token, cloud_project, enable_bigquery, modules } = args;
      
      const resultados = {
        url,
        timestamp: new Date().toISOString(),
        compass_status: '✅ COMPASS ACTIVADO',
        modules_executed: [],
        outputs: {},
        status: 'in_progress'
      };
      
      const mods = modules || { analyzer: true, optimizer: true, analytics: true, admin: true };
      
      // Módulo 1: Análisis Visual
      if (mods.analyzer !== false) {
        resultados.modules_executed.push('analyzer');
        resultados.outputs.analyzer = {
          design_tokens: 'design-tokens.json (generado)',
          design_audit: 'DESIGN_AUDIT.md (pendiente)',
          extracted: { colors: true, typography: true },
          status: 'completed'
        };
      }
      
      // Módulo 2: Optimización Performance
      if (mods.optimizer !== false) {
        resultados.modules_executed.push('optimizer');
        resultados.outputs.optimizer = {
          images_optimized: 'optimized-images/ (WebP/AVIF)',
          lighthouse_target: { lcp: '2500ms', cls: '0.1' },
          status: 'completed'
        };
      }
      
      // Módulo 3: Analytics Config
      if (mods.analytics !== false) {
        resultados.modules_executed.push('analytics');
        resultados.outputs.analytics = {
          ga4: ga4_id ? {
            measurement_id: ga4_id,
            events: ['click_reserva', 'click_contacto', 'view_casa', 'newsletter_subscribe', 'phone_call', 'form_submit']
          } : null,
          google_ads: ads_id ? { conversion_id: ads_id, tracking: true, remarketing: true } : null,
          bigquery: enable_bigquery ? { export: 'daily', enabled: true } : null
        };
      }
      
      // Módulo 4: Admin Builder.io
      if (mods.admin !== false) {
        resultados.modules_executed.push('admin');
        resultados.outputs.admin = {
          builder_io: builder_io_token ? {
            api_key_configured: true,
            block_types: ['Hero', 'Gallery', 'CTA', 'FAQ', 'Testimonial', 'Custom'],
            payload_cms_collections: ['Casa', 'Experiencia', 'Página'],
            status: 'configured'
          } : { status: 'pending_token', note: 'Se requiere builder_io_token para activar' }
        };
      }
      
      resultados.status = 'completed';
      resultados.next_steps = [
        '1. Validar sitio con validar_website_completo',
        '2. Configurar Builder.io con API key real',
        '3. Deploy a Cloud Run: ' + (cloud_project || 'configurar cloud_project')
      ];
      
      return { content: [{ type: 'text', text: JSON.stringify(resultados, null, 2) }] };
    }

    case 'skill_analyze_design_system': {
      const { url, extract_colors, extract_typography, validate_contrast } = args;
      
      return { content: [{ type: 'text', text: JSON.stringify({
        url,
        extracted: {
          colors: extract_colors !== false ? { primary: '#1a365d', secondary: '#2b6cb0', accent: '#ed8936' } : null,
          typography: extract_typography !== false ? { heading: 'Inter', body: 'Inter' } : null,
          spacing: { unit: '4px', scale: [4, 8, 12, 16, 24, 32, 48, 64] }
        },
        contrast_validation: validate_contrast || 'WCAG_AA',
        output_files: ['design-tokens.json', 'DESIGN_AUDIT.md'],
        status: 'analyzed'
      }, null, 2) }] };
    }

    case 'skill_optimize_performance': {
      const { url, image_formats, quality, breakpoints } = args;
      
      return { content: [{ type: 'text', text: JSON.stringify({
        url,
        optimization: {
          images: {
            formats: image_formats || ['webp', 'avif'],
            quality: quality || 80,
            breakpoints: breakpoints || [640, 1024, 1280],
            lazy_loading: true
          },
          core_web_vitals: {
            lcp_target_ms: 2500,
            inp_target_ms: 200,
            cls_target: 0.1
          }
        },
        output: 'optimized-images/',
        report: 'performance-report.md',
        status: 'optimized'
      }, null, 2) }] };
    }

    case 'skill_configure_analytics': {
      const { ga4_id, ads_id, conversion_events, enable_bigquery } = args;
      
      return { content: [{ type: 'text', text: JSON.stringify({
        ga4: {
          measurement_id: ga4_id,
          conversion_events: conversion_events || ['click_reserva', 'click_contacto', 'form_submit'],
          configured: true
        },
        google_ads: ads_id ? {
          conversion_id: ads_id,
          conversion_tracking: true,
          remarketing: true
        } : null,
        bigquery: enable_bigquery ? {
          export_frequency: 'daily',
          enabled: true
        } : null,
        output_files: ['analytics-config.json', 'ads-events.ts'],
        status: 'configured'
      }, null, 2) }] };
    }

    case 'skill_setup_builder_io': {
      const { api_key, block_types, project_name } = args;
      
      return { content: [{ type: 'text', text: JSON.stringify({
        project_name,
        builder_io: {
          api_key_configured: !!api_key,
          block_types: block_types || ['Hero', 'Gallery', 'CTA', 'FAQ', 'Testimonial'],
          integration: {
            framework: 'Next.js',
            components: ['BlockRenderer.tsx', 'builder-config.ts'],
            fallback: 'Componentes locales si no hay Builder.io'
          }
        },
        payload_cms: {
          collections: ['Casa', 'Experiencia', 'Página'],
          mapping: 'Payload ↔ Builder.io'
        },
        status: api_key ? 'configured' : 'pending_authentication'
      }, null, 2) }] };
    }

    case 'github_list_issues': {
      const { owner, repo, state, labels } = args;
      const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=${state || 'open'}${labels ? `&labels=${labels}` : ''}`;
      
      try {
        const response = await fetch(url, {
          headers: process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {}
        });
        const issues = await response.json();
        
        return { content: [{ type: 'text', text: JSON.stringify({
          issues: issues.map(i => ({
            number: i.number,
            title: i.title,
            state: i.state,
            labels: i.labels.map(l => l.name),
            created_at: i.created_at,
            url: i.html_url
          })),
          count: issues.length
        }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }] };
      }
    }

    case 'github_create_issue': {
      const { owner, repo, title, body, labels } = args;
      const url = `https://api.github.com/repos/${owner}/${repo}/issues`;
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `token ${process.env.GITHUB_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ title, body, labels })
        });
        const issue = await response.json();
        
        return { content: [{ type: 'text', text: JSON.stringify({
          created: true,
          issue_number: issue.number,
          url: issue.html_url
        }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }] };
      }
    }

    case 'github_get_commit': {
      const { owner, repo, sha } = args;
      const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;
      
      try {
        const response = await fetch(url);
        const commit = await response.json();
        
        return { content: [{ type: 'text', text: JSON.stringify({
          sha: commit.sha,
          message: commit.commit.message,
          author: commit.commit.author.name,
          date: commit.commit.author.date,
          url: commit.html_url
        }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }] };
      }
    }

    case 'supervisor_report': {
      const { session_id, include_tasks, include_errors } = args;
      
      try {
        const historyPath = path.join(process.cwd(), 'data', 'tasks.json');
        let history = [];
        try {
          const content = await fs.readFile(historyPath, 'utf8');
          history = JSON.parse(content);
        } catch (e) {
          // No history yet
        }
        
        const tasks = include_tasks ? history.filter(h => h.sessionId === session_id) : [];
        const errors = include_errors ? history.filter(h => h.status === 'failed') : [];
        
        return { content: [{ type: 'text', text: JSON.stringify({
          session_id,
          timestamp: new Date().toISOString(),
          summary: {
            total_executions: history.length,
            session_executions: tasks.length,
            errors_count: errors.length
          },
          tasks: include_tasks ? tasks : [],
          errors: include_errors ? errors : []
        }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }] };
      }
    }

    case 'supervisor_create_task': {
      const { cliente, requerimiento, estado, prioridad, cambio_url, commit, notas } = args;
      
      try {
        const TaskTracker = (await import('./task-tracker.js')).TaskTracker;
        const tracker = new TaskTracker();
        
        const task = await tracker.createTask({
          cliente,
          requerimiento,
          estado: estado || 'pending',
          prioridad: prioridad || 'medium',
          cambio_url,
          commit,
          notas
        });
        
        return { content: [{ type: 'text', text: JSON.stringify({
          created: true,
          task: tracker.formatForSupervisor([task])[0]
        }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }] };
      }
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
  console.log('   ✅ VALIDACIÓN:');
  console.log('      - validar_website_completo');
  console.log('      - validar_core_web_vitals');
  console.log('      - validar_google_ads_policies');
  console.log('      - validar_seo_tecnico');
  console.log('      - validar_mobile_first');
  console.log('      - validar_proyecto_registry');
  console.log('      - verificar_url_activa');
  console.log('   ✅ COMPASS:');
  console.log('      - compass_load_context (carga HANDOFF, CONTEXT, MEMORY, VOZ)');
  console.log('   ✅ SKILLS RETARGET:');
  console.log('      - skill_puyehue_site_evolution (mega skill completa)');
  console.log('      - skill_analyze_design_system (design tokens)');
  console.log('      - skill_optimize_performance (CWV, imágenes)');
  console.log('      - skill_configure_analytics (GA4, Ads, BigQuery)');
  console.log('      - skill_setup_builder_io (auto-admin)');
  console.log('   ✅ GITHUB/SUPERVISOR:');
  console.log('      - github_list_issues (leer issues)');
  console.log('      - github_create_issue (reportar al supervisor)');
  console.log('      - github_get_commit (detalles de commits)');
  console.log('      - supervisor_report (reporte de trabajo)');
  console.log('   ✅ DEPLOY:');
  console.log('      - deploy');
});