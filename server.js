require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://localhost:5000';
const ADMIN_EMAIL_RECEIVER = process.env.ADMIN_EMAIL_RECEIVER || 'your-email@gmail.com';
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecretkey';
const MONGO_URI = process.env.MONGO_URI;

// --- EMAIL TEMPLATE ---
const getEmailTemplate = (otp, type = 'Login') => {
    const formattedOtp = otp.toString().split('').join(' ');
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: sans-serif; }
            .webkit { max-width: 500px; background-color: #ffffff; margin: 0 auto; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; }
            .header { background-color: #4f46e5; padding: 30px; text-align: center; }
            .header h1 { margin: 0; color: #ffffff; font-size: 24px; }
            .content { padding: 30px; text-align: center; }
            .otp-box { background-color: #f8fafc; color: #4f46e5; font-size: 28px; font-weight: 700; padding: 15px 25px; border-radius: 12px; border: 2px dashed #cbd5e1; display: inline-block; }
            .footer { background-color: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; }
        </style>
    </head>
    <body>
        <br><div class="webkit">
            <div class="header"><h1>VerifyHub</h1></div>
            <div class="content">
                <h3>${type} Verification</h3>
                <p>Use the code below to access your dashboard.</p>
                <div class="otp-box">${formattedOtp}</div>
                <p>⚠️ Secure your account immediately.</p>
            </div>
            <div class="footer">&copy; ${new Date().getFullYear()} VerifyHub Security.</div>
        </div><br>
    </body>
    </html>`;
};

// --- MIDDLEWARE ---
app.use(helmet({ contentSecurityPolicy: false }));
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 5, message: "Too many login attempts." });
const otpLimiter = rateLimit({ windowMs: 10*60*1000, max: 10, message: "Too many OTP attempts." });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI, collectionName: 'sessions', ttl: 14 * 24 * 60 * 60 }),
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'strict' }
}));

const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.isLoggedIn) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return next();
    }
    if (req.xhr) return res.status(401).json({ success: false, message: 'Unauthorized' });
    res.redirect('/login');
};

// --- DB ---
const customerSchema = new mongoose.Schema({
    name: String, mobile: String, category: String, region: String,
    status: { type: String, default: 'pending' }, createdAt: { type: Date, default: Date.now },
    activationDate: Date, verificationDate: Date
});
const Customer = mongoose.model('Customer', customerSchema);

const connectDB = async () => {
    try { await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 5000, family: 4 }); console.log('✅ MongoDB Connected'); } 
    catch (err) { console.error('❌ MongoDB Error:', err.message); }
};
connectDB();

// --- ROUTES ---

app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/login', (req, res) => {
    if (req.session.isLoggedIn) return res.redirect('/');
    res.render('login', { error: null });
});

app.post('/login', loginLimiter, async (req, res) => {
    const { username, Vpassword, remember } = req.body;
    if (username === ADMIN_USERNAME && Vpassword === ADMIN_PASSWORD) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        req.session.otp = otp;
        req.session.tempUser = { username, remember };
        console.log(`🔐 OTP: ${otp}`);
        try {
            await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { recipient: ADMIN_EMAIL_RECEIVER, subject: '🔐 Login Code', message: getEmailTemplate(otp, 'Login') });
            res.redirect('/otp');
        } catch (error) { res.render('login', { error: 'Email Service Error' }); }
    } else { res.render('login', { error: 'Invalid Credentials' }); }
});

app.get('/otp', (req, res) => {
    if (!req.session.otp) return res.redirect('/login');
    res.render('otp', { error: null });
});

app.post('/verify-otp', otpLimiter, (req, res) => {
    const { otp } = req.body;
    const cleanOtp = otp.replace(/\s/g, '');
    if (req.session.otp && cleanOtp === req.session.otp) {
        req.session.isLoggedIn = true;
        if (req.session.tempUser.remember === 'on') req.session.cookie.maxAge = 365 * 24 * 60 * 60 * 1000;
        delete req.session.otp;
        delete req.session.tempUser;
        res.redirect('/');
    } else { res.render('otp', { error: 'Invalid OTP' }); }
});

app.post('/resend-otp', async (req, res) => {
    if (!req.session.tempUser) return res.status(401).json({ success: false });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    req.session.otp = otp;
    try {
        await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { recipient: ADMIN_EMAIL_RECEIVER, subject: '🔄 New Code', message: getEmailTemplate(otp, 'Resend') });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/login'); });
});

// --- MAIN FEATURES ---

// 1. HOME: PENDING (Filter: Verification Date)
app.get('/', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month;
        let monthOffset = (monthQuery === undefined) ? 0 : monthQuery;
        
        let query = { status: 'pending' };
        let headerTitle = "";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

        if (monthOffset === 'all') {
            headerTitle = "All Pending Tasks";
        } else {
            monthOffset = parseInt(monthOffset);
            const now = new Date();
            const startData = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
            const endData = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);
            query.verificationDate = { $gte: startData, $lt: endData };
            headerTitle = "Pending: " +qh_monthNames[startData.getMonth()] + " " + startData.getFullYear();
        }

        const customers = await Customer.find(query).sort({ verificationDate: 1 });
        res.render('index', { customers, error: null, page: 'home', monthOffset, headerTitle });
    } catch (err) {
        res.render('index', { customers: [], error: "Connection Error", page: 'home', monthOffset: 0, headerTitle: "Error" });
    }
});

// 2. ALL: HISTORY (Filter: Activation Date)
app.get('/all', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month;
        let monthOffset = (monthQuery === undefined) ? 0 : monthQuery;
        
        let query = {};
        let headerTitle = "";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

        if (monthOffset === 'all') {
            headerTitle = "All History";
        } else {
            monthOffset = parseInt(monthOffset);
            const now = new Date();
            const startData = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
            const endData = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);
            query = { activationDate: { $gte: startData, $lt: endData } };
            headerTitle = monthNames[startData.getMonth()] + " " + startData.getFullYear();
        }

        const allCustomers = await Customer.find(query).sort({ activationDate: -1 });
        res.render('all', { customers: allCustomers, page: 'all', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

// 3. ANALYTICS (Filter: Activation Date)
app.get('/analytics', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month;
        let monthOffset = (monthQuery === undefined) ? 0 : monthQuery;
        
        let query = {};
        let headerTitle = "";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

        if (monthOffset === 'all') {
            query = {}; // No Filter, fetch all time stats
            headerTitle = "All Time Analysis";
        } else {
            monthOffset = parseInt(monthOffset);
            const now = new Date();
            // Start of Target Month
            const startData = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
            // Start of Next Month (so < EndData covers full target month)
            const endData = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);
            
            query = { activationDate: { $gte: startData, $lt: endData } };
            headerTitle = "Analysis: " + monthNames[startData.getMonth()] + " " + startData.getFullYear();
        }

        const monthlyData = await Customer.find(query);
        const stats = {
            total: monthlyData.length,
            nc: monthlyData.filter(c => c.category === 'NC').length,
            p2p: monthlyData.filter(c => c.category === 'P2P').length,
            mnp: monthlyData.filter(c => c.category === 'MNP').length,
            completed: monthlyData.filter(c => c.status === 'completed').length,
            pending: monthlyData.filter(c => c.status === 'pending').length
        };
        res.render('analytics', { stats, page: 'analytics', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

// 4. MANAGE (Filter: Activation Date)
app.get('/manage', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month;
        let monthOffset = (monthQuery === undefined) ? 0 : monthQuery;
        
        let query = {};
        let headerTitle = "";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

        if (monthOffset === 'all') {
            headerTitle = "Managing All Records";
        } else {
            monthOffset = parseInt(monthOffset);
            const now = new Date();
            const startData = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
            const endData = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);
            query = { activationDate: { $gte: startData, $lt: endData } };
            headerTitle = "Manage: " + monthNames[startData.getMonth()] + " " + startData.getFullYear();
        }

        const allCustomers = await Customer.find(query).sort({ activationDate: -1 });
        res.render('manage', { customers: allCustomers, page: 'manage', monthOffset, headerTitle });
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
    try { await Customer.findByIdAndDelete(req.params.id); res.redirect('/manage'); } catch (err) { res.redirect('/manage'); }
});
app.post('/complete/:id', isAuthenticated, async (req, res) => {
    try { await Customer.findByIdAndUpdate(req.params.id, { status: 'completed' }); res.redirect('back'); } catch (err) { res.redirect('/'); }
});
app.get('*', (req, res) => { res.redirect('/'); });

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    const PING_INTERVAL = 5 * 60 * 1000;
    const TARGET_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    setInterval(async () => {
        try { await axios.get(`${TARGET_URL}/health`); console.log(`✅ Pinged ${TARGET_URL}`); } 
        catch (err) { console.error(`❌ Ping Failed`); }
    }, PING_INTERVAL);
});
