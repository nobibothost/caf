require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit'); // 🔥 Security Package

// --- Import Modular Routes & Models ---
const authRoutes = require('./routes/authRoutes');
const aiRoutes = require('./routes/aiRoutes');
const Customer = require('./models/Customer');

// --- Import Security Middleware ---
const requireAuth = require('./middleware/auth');

// --- Import Helpers & WhatsApp Engine ---
const { getPayout } = require('./utils/helpers');
const { connectToWhatsApp, getWaState } = require('./utils/whatsapp'); // 🔥 Imported getWaState

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://localhost:5000';
const ADMIN_EMAIL_RECEIVER = process.env.ADMIN_EMAIL_RECEIVER || 'your-email@gmail.com';
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecretkey';
const MONGO_URI = process.env.MONGO_URI;

// --- SECURITY MIDDLEWARES ---

// 1. Helmet helps secure Express apps by setting various HTTP headers.
app.use(helmet({ 
    contentSecurityPolicy: false, // Turned off to allow external scripts/charts if needed
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xPoweredBy: false // Hides "Express" to prevent targeted attacks
}));

// 2. Global Rate Limiting (Prevents DDoS and Brute Force Attacks)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 800, // Limit each IP to 800 requests per `window`
    message: 'Too many requests from this IP, please try again after 15 minutes.',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use(globalLimiter);

// 3. Strict Rate Limiting for Login/OTP (Stops Password Guessing)
const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 20, // Max 20 attempts
    message: 'Too many login attempts. Try again in 10 minutes.'
});
app.use('/login', authLimiter);
app.use('/verify-otp', authLimiter);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// Public static files (CSS/JS for login page)
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// --- SESSION SETUP (Encrypted & Hardened) ---
app.use(session({
    secret: SESSION_SECRET,
    name: 'sessionId', // Custom name instead of default 'connect.sid' (Security through obscurity)
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60, 
        autoRemove: 'native',
        touchAfter: 24 * 3600
    }),
    cookie: { 
        httpOnly: true, // Prevents client-side JS from reading the cookie (Stops XSS session hijacking)
        maxAge: 14 * 24 * 60 * 60 * 1000, 
        sameSite: 'strict', // Protects against CSRF attacks
        secure: process.env.NODE_ENV === 'production' // Only send over HTTPS in production
    }
}));

// --- DB CONNECTION ---
const connectDB = async () => {
    try { 
        await mongoose.connect(MONGO_URI, { 
            maxPoolSize: 10, minPoolSize: 2, socketTimeoutMS: 45000, serverSelectionTimeoutMS: 5000, family: 4              
        });
        console.log('✅ MongoDB Connected'); 
    } 
    catch (err) { console.error('❌ MongoDB Error:', err.message); setTimeout(connectDB, 5000); }
};
connectDB();

// --- GLOBAL ROUTES & MOUNTING ---
app.get('/health', (req, res) => res.status(200).send('OK'));

// 🔥 Power Off Route: Stops Server but KEEPS Session
app.post('/power-off', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Server Stopped</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700&display=swap" rel="stylesheet">
            <link href="https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css" rel="stylesheet">
        </head>
        <body style="font-family:'Inter', sans-serif; text-align:center; padding:50px 20px; background:#f8fafc; color:#0f172a; display:flex; flex-direction:column; align-items:center; justify-content:center; height:80vh; margin:0;">
            <div style="font-size:4.5rem; color:#ef4444; margin-bottom:15px; animation: scaleDown 0.5s ease-out;"><i class="ri-shut-down-line"></i></div>
            <h2 style="margin:0 0 10px 0; font-size:1.5rem;">Server Turned Off</h2>
            <p style="color:#64748b; font-size:0.95rem; max-width:300px; line-height:1.5;">Aapka session aur WhatsApp connection safe hai. Aap ab is tab ko close kar sakte hain. Wapas chalane ke liye Termux se server start karein.</p>
            <style>@keyframes scaleDown { from{transform:scale(1.2); opacity:0;} to{transform:scale(1); opacity:1;} }</style>
        </body>
        </html>
    `);
    console.log("🛑 Server shutdown requested via Web UI. Exiting in 1 second...");
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});

// 1. PUBLIC ROUTES (Accessible to everyone, protected by authLimiter)
app.use('/', authRoutes);

// 🔒 THE IRON GATE: Everything below this line requires login!
app.use(requireAuth); 

// 🔥 SECURE WHATSAPP STATUS ROUTE
app.get('/whatsapp', (req, res) => {
    const waState = getWaState();
    res.render('whatsapp', { 
        isConnected: waState.isConnected, 
        qr: waState.qr, 
        page: 'whatsapp' // Set active page for bottom navigation
    });
});

// 2. PRIVATE ROUTES (Fully protected)
app.use('/api/ai', aiRoutes);
app.use('/', require('./routes/viewRoutes'));
app.use('/', require('./routes/actionRoutes')); 
app.use('/', require('./routes/billingRoutes'));
app.use('/', require('./routes/reportRoutes'));

app.get('*', (req, res) => { res.redirect('/'); });

// --- SERVER & DAILY CRON JOBS ---
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🛡️ Security modules (Helmet, RateLimit, AuthLock) active!`);
    
    // 🔥 Start Background WhatsApp Automation Engine
    connectToWhatsApp();

    const PING_INTERVAL = 5 * 60 * 1000; 
    const TARGET_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    
    global.lastDailyEmail = null;
    global.lastKamaiEmail = null; 

    setInterval(async () => { 
        try { 
            await axios.get(`${TARGET_URL}/health`);
            
            const istNow = new Date(new Date().getTime() + (330 * 60000));
            const hours = istNow.getUTCHours();
            const todayStr = istNow.toISOString().split('T')[0];

            // 1. DAILY 10:00 AM PENDING TASKS ALERT
            if (hours === 10 && global.lastDailyEmail !== todayStr) {
                global.lastDailyEmail = todayStr;
                
                const pendingCount = await Customer.countDocuments({ status: 'pending', activationDate: { $lte: new Date(istNow.getTime() - (330*60000)) } });
                let msg = `
                <!DOCTYPE html>
                <html>
                <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
                <body style="margin: 0; padding: 0; background-color: #f4f7f6; font-family: 'Segoe UI', sans-serif;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f7f6; padding: 20px;">
                        <tr><td align="center">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
                                <tr><td style="background: linear-gradient(135deg, #10b981, #059669); padding: 30px 20px; text-align: center;"><h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 1px;">VerifyHub Daily Alert</h1></td></tr>
                                <tr><td style="padding: 40px 30px; text-align: center;">
                                    <h2 style="margin: 0 0 20px 0; color: #1e293b; font-size: 22px;">Good Morning, Admin! ☀️</h2>
                                    <div style="background-color: #fffbeb; border: 1px solid #fde68a; padding: 25px; border-radius: 12px; margin-bottom: 25px;">
                                        <span style="font-size: 42px; font-weight: 800; color: #d97706; display: block; margin-bottom: 5px; line-height: 1;">${pendingCount}</span>
                                        <span style="font-size: 15px; font-weight: 600; color: #92400e;">Pending Tasks For Today</span>
                                    </div>
                                    <p style="margin: 0; color: #64748b; font-size: 15px; line-height: 1.6;">Aapke dashboard par <b>${pendingCount}</b> forms activation ya verification ke liye pending hain.</p>
                                </td></tr>
                            </table>
                        </td></tr>
                    </table>
                </body>
                </html>`;
                
                await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { recipient: ADMIN_EMAIL_RECEIVER, subject: `Daily Alert: ${pendingCount} Pending Tasks`, message: msg });
            }

            // 2. DAILY 11:00 AM KAMAI (INCENTIVE) REPORT
            if (hours === 11 && global.lastKamaiEmail !== todayStr) {
                global.lastKamaiEmail = todayStr;

                const startOfMonth = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0) - (330*60000));
                const endOfMonth = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + 1, 0, 23, 59, 59, 999) - (330*60000));

                const allCustomers = await Customer.find().lean();
                let mnp_fam_c = 0, mnp_fam_r = 0; let other_fam_c = 0, other_fam_r = 0;
                let mnp_non_c = 0, mnp_non_r = 0; let fresh_non_c = 0, fresh_non_r = 0;
                let p2p_non_c = 0, p2p_non_r = 0;

                allCustomers.forEach(c => {
                    let cAct = new Date(c.activationDate || c.createdAt);
                    let isActThisMonth = (cAct >= startOfMonth && cAct <= endOfMonth);
                    let isActuallyActivated = (cAct <= istNow) || (c.status === 'completed');

                    if (isActThisMonth && isActuallyActivated) {
                        let earned = 0;
                        try { earned = getPayout(c.category, c.subType, c.plan) || 0; } catch(e) {}

                        let type = c.category; let sub = c.subType || c.category;

                        if (c.category === 'Family' && c.familyRole === 'Secondary') {
                            const pStatus = c.linkedPrimaryStatus || '';
                            if (!pStatus.includes('Existing') && !pStatus.includes('Active')) {
                                const primaryDoc = allCustomers.find(p => p.category === 'Family' && p.familyRole === 'Primary' && p.mobile === c.linkedPrimaryNumber);
                                if (!primaryDoc) {
                                    let ghostType = 'NC';
                                    if (pStatus.includes('NMNP')) ghostType = 'NMNP'; else if (pStatus.includes('MNP')) ghostType = 'MNP'; else if (pStatus.includes('P2P')) ghostType = 'P2P';
                                    else if (pStatus.includes('PDR')) ghostType = 'PDR';
                                    let ghostEarned = 0;
                                    try { ghostEarned = getPayout('Family', ghostType, c.plan) || 0; } catch(e){}
                                    if (ghostType === 'MNP' || ghostType === 'NMNP') { mnp_fam_c++; mnp_fam_r += ghostEarned; } else { other_fam_c++; other_fam_r += ghostEarned; }
                                }
                            }
                        }

                        if (type === 'Family') {
                            if (sub === 'MNP' || sub === 'NMNP') { mnp_fam_c++; mnp_fam_r += earned; } else if (sub !== 'Existing') { other_fam_c++; other_fam_r += earned; }
                        } else if (type === 'MNP' || type === 'NMNP') { mnp_non_c++; mnp_non_r += earned;
                        } else if (type === 'NC') { fresh_non_c++; fresh_non_r += earned;
                        } else if (type === 'P2P' || type === 'PDR') { p2p_non_c++; p2p_non_r += earned; }
                    }
                });
                let total_c = mnp_fam_c + other_fam_c + mnp_non_c + fresh_non_c + p2p_non_c;
                let total_r = mnp_fam_r + other_fam_r + mnp_non_r + fresh_non_r + p2p_non_r;
                let kamaiMsg = `
                <!DOCTYPE html>
                <html>
                <body style="margin: 0; padding: 20px; background-color: #f4f7f6; font-family: monospace; font-size: 16px;">
                    <div style="background-color: #ffffff; padding: 25px; border-radius: 8px; border: 1px solid #e2e8f0; color: #0f172a; max-width: 450px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                        <div style="color: #10b981; font-size: 22px; font-weight: bold; margin-bottom: 5px;">Meri Kamai</div>
                        <div style="font-weight: bold; border-bottom: 2px dashed #cbd5e1; padding-bottom: 12px; margin-bottom: 15px; color: #475569;">KPI/Gross/Incentive<br>ShamsadAlam</div>
                        <div style="line-height: 2.2; font-size: 16px; color: #1e293b;">
                            <div>MNP_FAMILY:/${mnp_fam_c}/${mnp_fam_r}</div><div>OTHER_FAMILY:/${other_fam_c}/${other_fam_r}</div><div>MNP_NON_FAMILY:/${mnp_non_c}/${mnp_non_r}</div><div>FRESH_NON_FAMILY:/${fresh_non_c}/${fresh_non_r}</div><div>P2P_NON_FAMILY:/${p2p_non_c}/${p2p_non_r}</div>
                        </div>
                        <div style="margin-top: 15px; border-top: 2px dashed #cbd5e1; padding-top: 15px; font-weight: bold; color: #059669; font-size: 18px;">TOTAL_GROSS_INCENTIVE:/${total_c}/${total_r}</div>
                    </div>
                </body>
                </html>`;

                await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { recipient: ADMIN_EMAIL_RECEIVER, subject: `Meri Kamai Report`, message: kamaiMsg });
            }
        } catch (err) {} 
    }, PING_INTERVAL);
});