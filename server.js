require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo'); // Session Persistence ke liye
const axios = require('axios');
// API calls
const helmet = require('helmet'); // Secure Headers
const rateLimit = require('express-rate-limit');
// Brute Force Protection

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://localhost:5000';
const ADMIN_EMAIL_RECEIVER = process.env.ADMIN_EMAIL_RECEIVER || 'your-email@gmail.com';
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecretkey';
const MONGO_URI = process.env.MONGO_URI; // Explicitly defined for Store

// --- HELPER: IMPROVED STYLISH EMAIL TEMPLATE ---
const getEmailTemplate = (otp, type = 'Login') => {
    // Make OTP readable (e.g., "123 456")
    const formattedOtp = otp.toString().split('').join(' ');
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { margin: 0;
                padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }
            .wrapper { width: 100%; table-layout: fixed; background-color: #f1f5f9;
                padding-bottom: 40px; }
            .webkit { max-width: 500px; background-color: #ffffff;
                margin: 0 auto; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;
            }
            .header { background-color: #4f46e5; padding: 30px 20px;
                text-align: center; }
            .header h1 { margin: 0;
                color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 1px; }
            .content { padding: 30px 25px;
                text-align: center; }
            .title { font-size: 18px; color: #1e293b;
                font-weight: 600; margin-bottom: 10px; }
            .text { font-size: 15px;
                color: #475569; line-height: 1.6; margin: 0 0 20px; }
            
            /* OTP BOX - Revised for No Line Breaks */
            .otp-container { margin: 25px 0;
            }
            .otp-box { 
                background-color: #f8fafc;
                color: #4f46e5; 
                font-size: 28px; /* Reduced from 36px */
                font-weight: 700;
                padding: 15px 25px; 
                border-radius: 12px; 
                letter-spacing: 4px; /* Slightly reduced */
                border: 2px dashed #cbd5e1;
                display: inline-block;
                white-space: nowrap; /* Prevents line break */
            }
            
            .warning { background-color: #fff1f2;
                color: #be123c; font-size: 13px; padding: 12px; border-radius: 8px; margin-top: 25px; border: 1px solid #ffe4e6;
            }
            .footer { background-color: #f8fafc; padding: 20px; text-align: center;
                font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <br>
            <div class="webkit">
                <div class="header">
                    <h1>VerifyHub</h1>
                </div>
                <div class="content">
                    <div class="title">${type} Verification</div>
                    <p class="text">Hello Admin, use the secure code below to access your dashboard.</p>
                   
                    <div class="otp-container">
                        <div class="otp-box">${formattedOtp}</div>
                    </div>
                    
                    <p class="text" style="font-size: 13px;">This code expires when your session ends.</p>
                    
                    <div class="warning">
                        ⚠️ If you did not request this, please secure your account immediately.
                    </div>
                </div>
                <div class="footer">
                    &copy;
                    ${new Date().getFullYear()} VerifyHub Security. All rights reserved.
                </div>
            </div>
            <br>
        </div>
    </body>
    </html>
    `;
};

// --- SECURITY MIDDLEWARE ---
app.use(helmet({
    contentSecurityPolicy: false,
}));
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: "Too many login attempts from this IP, please try again after 15 minutes",
    standardHeaders: true, 
    legacyHeaders: false,
});
const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, 
    max: 10, 
    message: "Too many OTP attempts, please wait.",
});
// --- BASIC MIDDLEWARE ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
// --- SESSION SETUP (UPDATED FOR PERSISTENCE) ---
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URI,
        collectionName: 'sessions', // Database me 'sessions' collection banega
        ttl: 14 * 24 * 60 * 60 // 14 Days expiration default
    }),
    cookie: { 
        httpOnly: true, 
        maxAge: 24 * 60 * 60 * 1000, // Default 1 day (Login pe change hoga)
        sameSite: 'strict', 
    }
}));
// --- AUTH MIDDLEWARE ---
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.isLoggedIn) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        return next();
    }
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
        return res.status(401).json({ success: false, message: 'Unauthorized Access' });
    }
    res.redirect('/login');
};

// --- DATABASE SCHEMA & CONNECT ---
const customerSchema = new mongoose.Schema({
    name: String, mobile: String, category: String, region: String,
    status: { type: String, default: 'pending' }, createdAt: { type: Date, default: Date.now },
    activationDate: Date, verificationDate: Date
});
const Customer = mongoose.model('Customer', customerSchema);

const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI, {
            useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 5000, family: 4
        });
        console.log('✅ MongoDB Connected Successfully');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
    }
};
connectDB();

// --- ROUTES ---

// 0. HEALTH CHECK (For Pinger)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});
// 1. LOGIN PAGE
app.get('/login', (req, res) => {
    if (req.session.isLoggedIn) return res.redirect('/');
    res.render('login', { error: null });
});
// 2. PROCESS LOGIN (Updated Email Logic)
app.post('/login', loginLimiter, async (req, res) => {
    const { username, Vpassword, remember } = req.body;

    if (username === ADMIN_USERNAME && Vpassword === ADMIN_PASSWORD) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        req.session.otp = otp;
        req.session.tempUser = { username, remember };

        console.log(`🔐 OTP Generated: ${otp}`);

        try {
            // Send HTML Email
            await axios.post(`${EMAIL_SERVICE_URL}/send-email`, {
                recipient: ADMIN_EMAIL_RECEIVER,
                subject: '🔐 VerifyHub Login Code',
                message: getEmailTemplate(otp, 'Login') // Sending Improved HTML content
            });
            res.redirect('/otp');
        } catch (error) {
            console.error('❌ Email Service Error:', error.message);
            res.render('login', { error: 'Email Service Unreachable.' });
        }
    } else {
        res.render('login', { error: 'Invalid Username or Password' });
    }
});

// 3. OTP PAGE
app.get('/otp', (req, res) => {
    if (!req.session.otp) return res.redirect('/login');
    res.render('otp', { error: null });
});
// 4. VERIFY OTP
app.post('/verify-otp', otpLimiter, (req, res) => {
    const { otp } = req.body;
    // Remove spaces if user copy-pasted from email "1 2 3 4 5 6" -> "123456"
    const cleanOtp = otp.replace(/\s/g, '');

    if (req.session.otp && cleanOtp === req.session.otp) {
        req.session.isLoggedIn = true;
        
        const remember = req.session.tempUser.remember;
        if (remember === 'on') {
             req.session.cookie.maxAge = 365 * 24 * 60 * 60 * 1000; // 1 Year
        } else {
            req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24 Hours
        }

        delete req.session.otp;
        delete req.session.tempUser;
        res.redirect('/');
    } else {
        res.render('otp', { error: 'Invalid OTP. Try again.' });
    }
});
// 5. RESEND OTP (Updated Email Logic)
app.post('/resend-otp', async (req, res) => {
    if (!req.session.tempUser) {
        return res.status(401).json({ success: false, message: 'Session expired. Login again.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    req.session.otp = otp;
    console.log(`🔄 OTP Resent: ${otp}`);

    try {
        await axios.post(`${EMAIL_SERVICE_URL}/send-email`, {
            recipient: ADMIN_EMAIL_RECEIVER,
            subject: '🔄 New Login Code',
            message: getEmailTemplate(otp, 'Resend') // Sending Improved HTML content
        });
        res.json({ success: true, message: 'OTP Resent Successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to send email.' });
    }
});
// 6. LOGOUT
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid'); 
        res.redirect('/login');
    });
});
// --- PROTECTED ROUTES ---

app.get('/', isAuthenticated, async (req, res) => {
    try {
        // Parse filter from query (default to 0 = This Month)
        const monthOffset = parseInt(req.query.month) || 0;
        
        // Calculate Date Range based on Offset
        const now = new Date();
        // Start date is 1st of the target month
        const startData = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
        // End date is 1st of the next month (to include all days of target month)
        const endData = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);

        // Helper for Month Name Display
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const currentMonthName = monthNames[startData.getMonth()] + " " + startData.getFullYear();

        // Fetch Data
        const customers = await Customer.find({
            verificationDate: { $gte: startData, $lt: endData }, 
            status: 'pending'
        }).sort({ verificationDate: 1 });

        res.render('index', { 
            customers, 
            error: null, 
            page: 'home', 
            monthOffset,
            currentMonthName 
        });
    } catch (err) {
        console.error(err);
        res.render('index', { 
            customers: [], 
            error: "Connection Error", 
            page: 'home', 
            monthOffset: 0,
            currentMonthName: "Error" 
        });
    }
});
app.get('/all', isAuthenticated, async (req, res) => {
    try {
        const allCustomers = await Customer.find({}).sort({ activationDate: -1 });
        res.render('all', { customers: allCustomers, page: 'all' });
    } catch (err) { res.redirect('/'); }
});
app.get('/analytics', isAuthenticated, async (req, res) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const monthlyData = await Customer.find({ activationDate: { $gte: startOfMonth, $lte: endOfMonth } });
        const stats = {
            total: monthlyData.length,
            nc: monthlyData.filter(c => c.category === 'NC').length,
            p2p: monthlyData.filter(c => c.category === 'P2P').length,
            mnp: monthlyData.filter(c => c.category === 'MNP').length,
            completed: monthlyData.filter(c => c.status === 'completed').length,
            pending: monthlyData.filter(c => c.status === 'pending').length
        };
        res.render('analytics', { stats, page: 'analytics' });
    } catch (err) { res.redirect('/'); }
});
app.get('/manage', isAuthenticated, async (req, res) => {
    try {
        const allCustomers = await Customer.find({}).sort({ activationDate: -1 });
        res.render('manage', { customers: allCustomers, page: 'manage' });
    } catch (err) { res.redirect('/'); }
});
app.post('/add', isAuthenticated, async (req, res) => {
    try {
        const { name, mobile, category, region, customDate } = req.body;
        let daysToAdd = 3; 
        if (category === 'MNP') { if (region === 'Delhi') { daysToAdd = 6; } else { daysToAdd = 8; } }
        const baseDate = customDate ? new Date(customDate) : new Date();
        const verificationDate = new Date(baseDate);
        verificationDate.setDate(verificationDate.getDate() + daysToAdd);
        verificationDate.setHours(0, 0, 0, 0);
        const newCustomer = new Customer({
            name, mobile, category, region: category === 'MNP' ? region : 'NA',
            activationDate: baseDate, verificationDate, status: 'pending'
        });
        await newCustomer.save();
        res.redirect('/');
    } catch (err) { res.redirect('/'); }
});

app.post('/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const { name, mobile, category, region, activationDate } = req.body;
        let daysToAdd = 3; 
        if (category === 'MNP') { if (region === 'Delhi') { daysToAdd = 6; } else { daysToAdd = 8; } }
        const baseDate = new Date(activationDate);
        const verificationDate = new Date(baseDate);
        verificationDate.setDate(verificationDate.getDate() + daysToAdd);
        verificationDate.setHours(0, 0, 0, 0);
        await Customer.findByIdAndUpdate(req.params.id, {
            name, mobile, category, region: category === 'MNP' ? region : 'NA',
            activationDate: baseDate, verificationDate
        });
        res.redirect('/manage');
    } catch (err) { res.redirect('/manage'); }
});
app.post('/delete/:id', isAuthenticated, async (req, res) => {
    try { await Customer.findByIdAndDelete(req.params.id); res.redirect('/manage'); } 
    catch (err) { res.redirect('/manage'); }
});
app.post('/complete/:id', isAuthenticated, async (req, res) => {
    try { await Customer.findByIdAndUpdate(req.params.id, { status: 'completed' }); res.redirect('back'); } 
    catch (err) { res.redirect('/'); }
});
app.get('*', (req, res) => { res.redirect('/'); });

app.listen(PORT, () => {
    console.log(`🚀 Verification Server running on http://localhost:${PORT}`);
    if(!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
        console.log('⚠️ Warning: .env variables for Login are missing!');
    }

    // --- 5 MINUTE SELF PINGER (KEEP ALIVE) ---
    const PING_INTERVAL = 5 * 60 * 1000; // 5 Minutes in milliseconds
    const TARGET_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`; // Default to localhost

    setInterval(async () => {
        try {
            await axios.get(`${TARGET_URL}/health`);
            // LOG UPDATED TO SHOW TARGET URL
            console.log(`✅ [${new Date().toLocaleTimeString()}] Pinged ${TARGET_URL}/health`);
        } catch (err) {
            console.error(`❌ [${new Date().toLocaleTimeString()}] Keep-Alive Ping Failed: ${err.message}`);
        }
    }, PING_INTERVAL);
});
