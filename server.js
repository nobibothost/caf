require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit'); 

// --- Import Modular Routes & Models ---
const authRoutes = require('./routes/authRoutes');
const aiRoutes = require('./routes/aiRoutes');
const Customer = require('./models/Customer'); 

// --- Import Security Middleware ---
const requireAuth = require('./middleware/auth');

// --- Import Helpers, WhatsApp Engine & Scheduler ---
const { connectToWhatsApp, getWaState } = require('./utils/whatsapp'); 
const { startCronJobs } = require('./utils/scheduler'); 

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecretkey';
const MONGO_URI = process.env.MONGO_URI;

// --- SECURITY MIDDLEWARES ---
app.use(helmet({ 
    contentSecurityPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xPoweredBy: false 
}));

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 800, 
    message: 'Too many requests from this IP, please try again after 15 minutes.',
    standardHeaders: true, 
    legacyHeaders: false, 
});
app.use(globalLimiter);

const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, 
    max: 20, 
    message: 'Too many login attempts. Try again in 10 minutes.'
});
app.use('/login', authLimiter);
app.use('/verify-otp', authLimiter);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// 🔥 FIX FOR RENDER: Trust proxy
app.set('trust proxy', 1);

// --- SESSION SETUP (PWA Persistent Fix Applied) ---
app.use(session({
    secret: SESSION_SECRET,
    name: 'vHub_session', // Persistent Cookie Name
    resave: true, 
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({
        mongoUrl: MONGO_URI,
        collectionName: 'sessions',
        ttl: 365 * 24 * 60 * 60, 
        autoRemove: 'native',
        touchAfter: 1
    }),
    cookie: { 
        httpOnly: true, 
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        sameSite: 'lax', 
        secure: process.env.NODE_ENV === 'production' 
    }
}));

// --- DB CONNECTION ---
const connectDB = async () => {
    try { 
        await mongoose.connect(MONGO_URI, { 
            maxPoolSize: 10, minPoolSize: 2, socketTimeoutMS: 45000, serverSelectionTimeoutMS: 5000, family: 4              
        });
        console.log('✅ MongoDB Connected'); 
        
        Customer.collection.createIndex({ mobile: 1 }).catch(()=>{});
        Customer.collection.createIndex({ name: 1 }).catch(()=>{});
        Customer.collection.createIndex({ status: 1, activationDate: -1 }).catch(()=>{});
        Customer.collection.createIndex({ category: 1 }).catch(()=>{});
        console.log('⚡ Smart Indexes Activated: Search & Load will be 10x faster!');
        
    } 
    catch (err) { console.error('❌ MongoDB Error:', err.message); setTimeout(connectDB, 5000); }
};
connectDB();

// --- GLOBAL ROUTES & MOUNTING ---
app.get('/health', (req, res) => res.status(200).send('OK'));

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

// 1. PUBLIC ROUTES
app.use('/', authRoutes);

// 🔒 THE IRON GATE: Everything below requires login!
app.use(requireAuth); 

// 🔥 API FOR REAL-TIME WA STATUS INDICATOR
app.get('/api/wa-status', (req, res) => {
    const waState = getWaState();
    res.json({ isConnected: waState.isConnected });
});

// 🔥 SECURE WHATSAPP STATUS ROUTE
app.get('/whatsapp', (req, res) => {
    const waState = getWaState();
    res.render('whatsapp', { 
        isConnected: waState.isConnected, 
        qr: waState.qr, 
        page: 'whatsapp' 
    });
});

// 2. PRIVATE ROUTES
app.use('/api/ai', aiRoutes);
app.use('/', require('./routes/viewRoutes'));
app.use('/', require('./routes/actionRoutes')); 
app.use('/', require('./routes/billingRoutes'));
app.use('/', require('./routes/reportRoutes'));

app.get('*', (req, res) => { res.redirect('/'); });

// --- SERVER INITIALIZATION ---
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🛡️ Security modules active!`);
    connectToWhatsApp();
    startCronJobs();
});