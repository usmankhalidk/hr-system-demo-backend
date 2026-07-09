import { NextFunction, Request, Response } from 'express';
import { 
  listPublicJobs, 
  getPublicJobById, 
  getPublicCompanyBySlug,
  getPublicCompanyById,
  mapPublicJob
} from '../modules/publicCareers/publicCareers.routes';
import { salaryPeriodItalianLabel } from '../utils/salaryPeriod';

// In-memory cache for rendered HTML pages
interface CacheEntry {
  html: string;
  expiry: number;
}

const renderCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3600 * 1000; // 1 hour

// Helper to resolve frontend base URL
function resolveFrontendBase(req: Request): string {
  const raw = process.env.FRONTEND_URL ?? process.env.PUBLIC_APP_URL ?? process.env.CORS_ORIGIN?.split(',')[0];
  if (raw && raw.trim() !== '') {
    return raw.replace(/\/+$/, '');
  }

  const host = req.get('host');
  if (host) {
    // If running inside docker/behind nginx, host might be backend:3001, but req.protocol and request headers might help
    const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
    const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol;
    if (forwardedHost) {
      return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, '');
    }
    return `${req.protocol}://${host}`.replace(/\/+$/, '');
  }

  return 'http://localhost:5173';
}

// Helper to escape HTML characters
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Generate premium, responsive HTML template wrapper
function wrapPageTemplate(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #c9973a;
      --primary-hover: #b0822e;
      --dark: #0f172a;
      --gray-light: #f8fafc;
      --gray-border: #e2e8f0;
      --text: #334155;
      --text-dark: #0f172a;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Outfit', sans-serif;
      line-height: 1.6;
      color: var(--text);
      background-color: var(--gray-light);
      padding: 0;
      margin: 0;
    }
    header {
      background-color: var(--dark);
      color: white;
      padding: 24px 5%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid var(--primary);
    }
    header h1 {
      font-size: 24px;
      font-weight: 800;
      color: white;
      letter-spacing: -0.5px;
    }
    header h1 span {
      color: var(--primary);
    }
    .container {
      max-width: 1000px;
      margin: 40px auto;
      padding: 0 20px;
    }
    .card {
      background: white;
      border: 1px solid var(--gray-border);
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05);
    }
    h2 {
      font-size: 28px;
      font-weight: 700;
      color: var(--text-dark);
      margin-bottom: 16px;
    }
    .meta-group {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 24px;
    }
    .badge {
      background-color: #f1f5f9;
      color: #475569;
      padding: 6px 12px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
    }
    .badge.primary {
      background-color: rgba(201, 151, 58, 0.1);
      color: var(--primary-hover);
    }
    .divider {
      height: 1px;
      background-color: var(--gray-border);
      margin: 24px 0;
    }
    .rich-text {
      color: var(--text);
      font-size: 16px;
    }
    .rich-text h1, .rich-text h2, .rich-text h3 {
      color: var(--text-dark);
      margin-top: 20px;
      margin-bottom: 10px;
    }
    .rich-text p {
      margin-bottom: 16px;
    }
    .rich-text ul, .rich-text ol {
      margin-left: 24px;
      margin-bottom: 16px;
    }
    .rich-text li {
      margin-bottom: 6px;
    }
    .btn-apply {
      display: inline-block;
      background-color: var(--primary);
      color: white;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 16px;
      transition: background-color 0.2s;
      margin-top: 20px;
    }
    .btn-apply:hover {
      background-color: var(--primary-hover);
    }
    .job-list {
      display: grid;
      gap: 20px;
    }
    .job-card {
      background: white;
      border: 1px solid var(--gray-border);
      border-radius: 12px;
      padding: 24px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .job-card h3 {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-dark);
      margin-bottom: 8px;
    }
    .job-card p {
      color: var(--text);
      font-size: 15px;
      margin-bottom: 16px;
    }
    .job-card-link {
      color: var(--primary);
      text-decoration: none;
      font-weight: 700;
      font-size: 14px;
      display: inline-flex;
      align-items: center;
    }
    .job-card-link:hover {
      color: var(--primary-hover);
      text-decoration: underline;
    }
    footer {
      text-align: center;
      padding: 40px 20px;
      color: #64748b;
      font-size: 14px;
      border-top: 1px solid var(--gray-border);
      margin-top: 60px;
      background: white;
    }
    footer a {
      color: #64748b;
      text-decoration: underline;
      margin: 0 10px;
    }
    footer a:hover {
      color: var(--primary);
    }
  </style>
</head>
<body>
  <header>
    <h1>Fusaro Uomo <span>Careers</span></h1>
  </header>
  <main class="container">
    ${content}
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} Fusaro Uomo. All rights reserved.</p>
    <p>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/cookie-policy">Cookie Policy</a>
    </p>
  </footer>
</body>
</html>`;
}

// Standard policy text pages
function getPrivacyPolicyHtml(): string {
  return `
    <div class="card">
      <h2>Privacy Policy / Informativa sulla Privacy</h2>
      <div class="rich-text">
        <p><strong>Ultimo aggiornamento: 4 Giugno 2026</strong></p>
        <p>Questa informativa descrive come trattiamo i dati personali dei candidati che applicano alle posizioni aperte presso Fusaro Uomo. Ci impegniamo a garantire la riservatezza e la sicurezza dei dati forniti, in piena conformità al Regolamento Generale sulla Protezione dei Dati (GDPR - Regolamento UE 2016/679).</p>
        
        <h3>1. Dati Raccolti</h3>
        <p>Raccogliamo le seguenti categorie di dati nel contesto delle candidature:</p>
        <ul>
          <li>Nome, cognome, indirizzo email, recapito telefonico.</li>
          <li>CV/Resume, lettere di presentazione e referenze professionali.</li>
          <li>Precedenti esperienze lavorative, livello di istruzione e competenze.</li>
          <li>Disponibilità lavorativa, aspettative salariali e preferenze di sede.</li>
        </ul>

        <h3>2. Finalità del Trattamento</h3>
        <p>I dati raccolti vengono utilizzati esclusivamente per scopi legati al processo di recruiting, inclusa la valutazione del profilo per la posizione selezionata o per future opportunità lavorative all'interno del gruppo.</p>

        <h3>3. Conservazione dei Dati</h3>
        <p>I dati dei candidati saranno conservati per un periodo massimo di 24 mesi dall'ultimo contatto o dall'invio della candidatura, dopodiché verranno eliminati o resi anonimi in modo sicuro.</p>

        <h3>4. I Tuoi Diritti</h3>
        <p>Ai sensi del GDPR, hai il diritto di accedere ai tuoi dati personali, richiederne la rettifica o la cancellazione, limitarne il trattamento, o opporti allo stesso inviando una email al nostro team di risorse umane.</p>
      </div>
    </div>
  `;
}

function getTermsHtml(): string {
  return `
    <div class="card">
      <h2>Terms of Service / Termini di Servizio</h2>
      <div class="rich-text">
        <p><strong>Ultimo aggiornamento: 4 Giugno 2026</strong></p>
        <p>Benvenuto nel portale Careers di Fusaro Uomo. Utilizzando questo portale per consultare gli annunci di lavoro e inviare la tua candidatura, accetti i presenti Termini di Servizio.</p>
        
        <h3>1. Utilizzo del Portale</h3>
        <p>Il portale è destinato a candidati reali in cerca di impiego presso Fusaro Uomo. È vietato l'invio di dati falsi, incompleti o fuorvianti. È vietato qualsiasi tentativo di alterare il funzionamento tecnico del sistema.</p>

        <h3>2. Candidature</h3>
        <p>L'invio di una candidatura non costituisce alcuna offerta formale di impiego né garantisce un colloquio conoscitivo. Il team recruiting valuterà le risposte a propria discrezione.</p>

        <h3>3. Proprietà Intellettuale</h3>
        <p>Tutti i contenuti presenti sul portale (loghi, testi, descrizioni delle posizioni) sono di proprietà esclusiva di Fusaro Uomo e non possono essere riutilizzati o diffusi senza autorizzazione.</p>
      </div>
    </div>
  `;
}

function getCookiePolicyHtml(): string {
  return `
    <div class="card">
      <h2>Cookie Policy / Politica sui Cookie</h2>
      <div class="rich-text">
        <p><strong>Ultimo aggiornamento: 4 Giugno 2026</strong></p>
        <p>Il portale Careers di Fusaro Uomo utilizza cookie e tecnologie simili per migliorare l'esperienza di navigazione ed analizzare l'uso del nostro portale.</p>
        
        <h3>1. Cosa sono i Cookie</h3>
        <p>I cookie sono piccoli file di testo salvati sul tuo dispositivo durante la visita del sito. Consentono di memorizzare preferenze di navigazione (come la lingua selezionata) e informazioni sulle sessioni.</p>

        <h3>2. Cookie Utilizzati</h3>
        <ul>
          <li><strong>Cookie Tecnici Essenziali:</strong> Necessari per il funzionamento di base del portale (es. gestione delle sessioni di candidatura).</li>
          <li><strong>Cookie Analitici:</strong> Utilizzati in forma anonima per monitorare le statistiche di visita del sito (es. quante visite riceve un annuncio).</li>
        </ul>

        <h3>3. Gestione dei Cookie</h3>
        <p>Puoi scegliere di disabilitare o bloccare i cookie tramite le impostazioni del tuo browser web, ma questo potrebbe compromettere la corretta compilazione ed invio del modulo di candidatura.</p>
      </div>
    </div>
  `;
}

export const ssrRendererMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const rawPath = req.path.toLowerCase().replace(/\/$/, ''); // Normalize trailing slash
  const isSsrPrefix = rawPath.startsWith('/ssr/');
  const path = isSsrPrefix ? rawPath.substring(4) : rawPath;

  const userAgent = req.get('user-agent') || '';
  const isBot = /Indeedbot|Googlebot|Bingbot|facebookexternalhit|Twitterbot/i.test(userAgent);

  const botRoutes = [
    /^\/careers$/,
    /^\/careers\/.+/,
    /^\/privacy$/,
    /^\/terms$/,
    /^\/cookie-policy$/
  ];

  const isBotRoute = botRoutes.some(regex => regex.test(path));

  // If this is not a route that needs bot-rendering, bypass immediately
  if (!isBotRoute) {
    next();
    return;
  }

  // Handle static legal compliance pages for both bots and humans
  if (path === '/privacy' || path === '/terms' || path === '/cookie-policy') {
    let content = '';
    let title = '';
    
    if (path === '/privacy') {
      title = 'Privacy Policy | Fusaro Uomo Careers';
      content = getPrivacyPolicyHtml();
    } else if (path === '/terms') {
      title = 'Terms of Service | Fusaro Uomo Careers';
      content = getTermsHtml();
    } else {
      title = 'Cookie Policy | Fusaro Uomo Careers';
      content = getCookiePolicyHtml();
    }

    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(wrapPageTemplate(title, content));
    return;
  }

  // If a human hits this on the backend port directly (e.g. testing or deep linking),
  // redirect them to the actual frontend SPA to prevent backend 404s.
  // Bypass this check if the request has the /ssr/ prefix so curl tests can render the page.
  if (!isBot && !isSsrPrefix) {
    const frontendUrl = resolveFrontendBase(req) + req.originalUrl;
    res.redirect(frontendUrl);
    return;
  }

  // --- BOT RENDER START ---
  
  // Check in-memory cache first
  const cacheKey = req.originalUrl; // Keep query params in cache key (e.g. language preferences)
  const cached = renderCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(cached.html);
    return;
  }

  try {
    const frontendBase = resolveFrontendBase(req);

    // Case 1: Job detail page (/careers/jobs/:jobId or /careers/:companySlug/jobs/:jobId)
    const jobDetailMatch = path.match(/^\/careers(?:\/([^/]+))?\/jobs\/(\d+)$/);
    if (jobDetailMatch) {
      const companySlug = jobDetailMatch[1]; // Optional
      const jobId = parseInt(jobDetailMatch[2], 10);

      const jobRow = await getPublicJobById(jobId, companySlug);
      if (!jobRow) {
        res.status(404).setHeader('Content-Type', 'text/html; charset=UTF-8').send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Posizione non trovata</title>
</head>
<body>
  <h1>Posizione non trovata</h1>
  <p>L'annuncio cercato non è disponibile o è stato rimosso.</p>
</body>
</html>`);
        return;
      }

      const job = mapPublicJob(jobRow);

      // Strip HTML tags for meta description (simple regex replace)
      const plainDesc = (job.description || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const shortDesc = plainDesc.slice(0, 160);

      // JSON-LD JobPosting schema mapping
      const mapEmploymentType = (jobType: string | null | undefined): string => {
        const t = (jobType || '').toLowerCase().replace(/[-_]/g, '');
        if (t === 'fulltime') return 'FULL_TIME';
        if (t === 'parttime') return 'PART_TIME';
        if (t === 'contractor') return 'CONTRACTOR';
        return 'FULL_TIME';
      };

      const ldJson = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": job.title,
        "description": plainDesc.slice(0, 5000),
        "datePosted": job.published_at ? new Date(job.published_at).toISOString() : new Date(job.created_at).toISOString(),
        "employmentType": mapEmploymentType(job.job_type),
        "hiringOrganization": {
          "@type": "Organization",
          "name": job.company_name
        },
        "jobLocation": {
          "@type": "Place",
          "address": {
            "@type": "PostalAddress",
            "addressLocality": job.job_city || '',
            "addressRegion": job.job_state || '',
            "postalCode": job.job_postal_code || '',
            "addressCountry": job.job_country || 'IT'
          }
        }
      };

      // Construct salary HTML block if salary_min is present
      let salaryHtml = '';
      if (job.salary_min != null) {
        const maxPart = job.salary_max != null ? `–${job.salary_max}` : '';
        // Render the Italian period label rather than the raw stored token.
        const periodLabel = salaryPeriodItalianLabel(job.salary_period);
        const periodPart = periodLabel ? ` ${periodLabel}` : '';
        salaryHtml = `<p>Stipendio: ${job.salary_min}${maxPart}${periodPart}</p>`;
      }

      const companySlugForUrl = companySlug || job.company_slug || 'fusaro-uomo';

      const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(job.title)} | ${escapeHtml(job.company_name)}</title>
  <meta name="description" content="${escapeHtml(shortDesc)}">
  <meta property="og:title" content="${escapeHtml(job.title)}">
  <meta property="og:description" content="${escapeHtml(shortDesc)}">
  <link rel="canonical" href="https://veylohr.com/careers/${escapeHtml(companySlugForUrl)}/jobs/${jobId}">
  <script type="application/ld+json">
  ${JSON.stringify(ldJson, null, 2)}
  </script>
</head>
<body>
  <nav><a href="https://veylohr.com/careers/${escapeHtml(companySlugForUrl)}">${escapeHtml(job.company_name)} — Posizioni aperte</a></nav>
  <main>
    <h1>${escapeHtml(job.title)}</h1>
    <p>${escapeHtml(job.job_city || '')}, ${escapeHtml(job.job_country || '')}</p>
    <p>${escapeHtml(job.company_name)}</p>
    ${salaryHtml}
    <section>${job.description || ''}</section>
    <a href="https://veylohr.com/careers/${escapeHtml(companySlugForUrl)}/jobs/${jobId}">
      Candidati per questa posizione
    </a>
  </main>
</body>
</html>`;

      // Cache result
      renderCache.set(cacheKey, { html, expiry: Date.now() + CACHE_TTL_MS });

      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.send(html);
      return;
    }

    // Case 2: Careers index page (/careers or /careers/:companySlug)
    const indexMatch = path.match(/^\/careers(?:\/([^/]+))?$/);
    if (indexMatch) {
      const companySlug = indexMatch[1]; // Optional
      const jobRows = await listPublicJobs(companySlug);
      
      let companyName = 'Tutte le aziende';
      if (companySlug) {
        const companyRow = await getPublicCompanyBySlug(companySlug);
        if (companyRow) {
          companyName = companyRow.name;
        }
      }

      const jobCards = jobRows.map(row => {
        const job = mapPublicJob(row);
        const detailUrl = `/careers/${job.company_slug}/jobs/${job.id}`;
        const locationText = job.remote_type === 'remote' ? 'Remoto' : `${job.job_city || ''}, ${job.job_state || ''}`.replace(/^,\s*/, '');
        const snippet = (job.description ?? '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180) + '...';

        return `
          <article class="job-card">
            <h3>${escapeHtml(job.title)}</h3>
            <div class="meta-group" style="margin-bottom: 12px;">
              <span class="badge primary">${escapeHtml(job.company_name)}</span>
              <span class="badge">${escapeHtml(locationText)}</span>
              <span class="badge">${escapeHtml(job.job_type)}</span>
            </div>
            <p>${escapeHtml(snippet)}</p>
            <a href="${escapeHtml(detailUrl)}" class="job-card-link">Leggi Dettagli / View Details &rarr;</a>
          </article>
        `;
      }).join('\n');

      const content = `
        <div style="margin-bottom: 30px;">
          <h2>Posizioni Aperte a ${escapeHtml(companyName)}</h2>
          <p>Esplora le opportunità di carriera e unisciti al nostro team.</p>
        </div>
        <div class="job-list">
          ${jobCards || '<div class="card" style="text-align: center;"><p>Al momento non ci sono posizioni aperte.</p></div>'}
        </div>
      `;

      const title = `Posizioni Aperte presso ${companyName} | Careers`;
      const html = wrapPageTemplate(title, content);

      // Cache result
      renderCache.set(cacheKey, { html, expiry: Date.now() + CACHE_TTL_MS });

      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.send(html);
      return;
    }

    // Default fallback
    next();
  } catch (error) {
    console.error('[SSR_RENDERER_MIDDLEWARE] Failed to render bot page:', error);
    next();
  }
};
