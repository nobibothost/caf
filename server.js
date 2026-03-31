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

const ITEMS_PER_PAGE = 10;

/* ==========================================================================
   🔥 BUSINESS LOGIC & RULES 🔥
   ========================================================================== */
const RULES = {
    ACTIVATION_DELAY: {
        'NC': 0,          
        'P2P': 0,         
        'MNP': 3,         
        'NMNP': 5,        
        'Existing': 0     
    },
    VERIFICATION_DELAY: 3 
};

// --- HELPER: TIMEZONE FIX (IST) ---
function getISTDate(offsetMonths = 0) {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const nd = new Date(utc + (3600000 * 5.5)); 
    
    let targetYear = nd.getFullYear();
    let targetMonth = nd.getMonth() - offsetMonths;

    const start = new Date(Date.UTC(targetYear, targetMonth, 1));
    start.setHours(start.getHours() - 5);
    start.setMinutes(start.getMinutes() - 30);
    
    const end = new Date(Date.UTC(targetYear, targetMonth + 1, 1));
    end.setHours(end.getHours() - 5);
    end.setMinutes(end.getMinutes() - 30);

    return { start, end, now: new Date() };
}

// --- HELPER: CALCULATE RUNS ---
function getRuns(category, subType) {
    if (category === 'Family') {
        if (subType === 'MNP' || subType === 'NMNP') return 3; 
        return 1; 
    } else {
        if (subType === 'MNP' || subType === 'NMNP') return 2; 
        return 1; 
    }
}

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
app.use(helmet({ 
    contentSecurityPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 5, message: "Too many login attempts." });
const otpLimiter = rateLimit({ windowMs: 10*60*1000, max: 10, message: "Too many OTP attempts." });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// --- SESSION SETUP ---
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60, 
        autoRemove: 'native',
        touchAfter: 24 * 3600
    }),
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

// --- DB SCHEMA ---
const customerSchema = new mongoose.Schema({
    name: String, 
    mobile: String, 
    category: String, 
    subType: String, 
    region: { type: String, default: 'NA' }, 
    familyRole: { type: String, default: 'Secondary' }, 
    linkedPrimaryName: String, 
    linkedPrimaryNumber: String, 
    linkedPrimaryStatus: String, 
    remarks: { type: String, default: '' },
    status: { type: String, default: 'pending' }, 
    createdAt: { type: Date, default: Date.now }, 
    activationDate: Date, 
    verificationDate: Date,
    billDate: { type: Number, default: null }, 
    paidMonths: { type: [String], default: [] } 
});

const Customer = mongoose.model('Customer', customerSchema);

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

// --- LOGIC CALCULATOR ---
function calculateLogic(baseDate, type) {
    const activationDelay = RULES.ACTIVATION_DELAY[type] !== undefined ? RULES.ACTIVATION_DELAY[type] : 0;
    const realActivationDate = new Date(baseDate);
    realActivationDate.setDate(realActivationDate.getDate() + activationDelay);
    realActivationDate.setHours(0,0,0,0);

    const realVerificationDate = new Date(realActivationDate);
    if (type !== 'Existing') {
        realVerificationDate.setDate(realVerificationDate.getDate() + RULES.VERIFICATION_DELAY);
    }
    realVerificationDate.setHours(0,0,0,0);
    return { realActivationDate, realVerificationDate };
}

// --- HELPER: FETCH AND GROUP CUSTOMERS ---
async function fetchGroupedCustomers(baseQuery, sortObj) {
    const matchingDocs = await Customer.find(baseQuery).sort(sortObj).lean();
    
    let displayMap = new Map();
    let normalCustomers = [];
    
    for (let doc of matchingDocs) {
        if (doc.category === 'Family') {
            if (doc.familyRole === 'Secondary') {
                if (!displayMap.has(doc._id.toString())) {
                    const primaryDoc = await Customer.findOne({
                        category: 'Family',
                        familyRole: 'Primary',
                        mobile: doc.linkedPrimaryNumber
                    }).lean();
                    doc.primaryDoc = primaryDoc;
                    displayMap.set(doc._id.toString(), doc);
                }
            } else if (doc.familyRole === 'Primary') {
                const secondaryDoc = await Customer.findOne({
                    category: 'Family',
                    familyRole: 'Secondary',
                    linkedPrimaryNumber: doc.mobile
                }).lean();
                
                if (secondaryDoc) {
                    if (!displayMap.has(secondaryDoc._id.toString())) {
                        secondaryDoc.primaryDoc = doc;
                        displayMap.set(secondaryDoc._id.toString(), secondaryDoc);
                    }
                } else {
                    normalCustomers.push(doc);
                }
            }
        } else {
            normalCustomers.push(doc);
        }
    }
    
    let result = [...Array.from(displayMap.values()), ...normalCustomers];
    
    if (sortObj && sortObj.verificationDate) {
        result.sort((a, b) => {
            const dateA = a.verificationDate || a.createdAt;
            const dateB = b.verificationDate || b.createdAt;
            return sortObj.verificationDate === 1 ? dateA - dateB : dateB - dateA;
        });
    } else if (sortObj && sortObj.createdAt) {
         result.sort((a, b) => {
            const dateA = a.createdAt;
            const dateB = b.createdAt;
            return sortObj.createdAt === 1 ? dateA - dateB : dateB - dateA;
        });
    }

    return result;
}

// --- HELPER: SAFE REDIRECT TO FIX BROWSER REFERER ISSUES ---
const safeRedirect = (req, res) => {
    const returnUrl = req.body.returnUrl;
    if (returnUrl && returnUrl.startsWith('/')) {
        return res.redirect(returnUrl);
    }
    return res.redirect('back');
};

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
        req.session.otp = otp; req.session.tempUser = { username, remember };
        try { 
            await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { 
                recipient: ADMIN_EMAIL_RECEIVER, 
                subject: '🔐 Login Code', 
                message: getEmailTemplate(otp, 'Login') 
            }); 
            res.redirect('/otp'); 
        } 
        catch (error) { res.render('login', { error: 'Email Service Error' }); }
    } 
    else { res.render('login', { error: 'Invalid Credentials' }); }
});

app.get('/otp', (req, res) => { 
    if (!req.session.otp) return res.redirect('/login'); 
    res.render('otp', { error: null }); 
});

app.post('/verify-otp', otpLimiter, (req, res) => {
    const { otp } = req.body;
    if (req.session.otp && otp.replace(/\s/g, '') === req.session.otp) {
        req.session.isLoggedIn = true; 
        req.session.cookie.maxAge = (req.session.tempUser.remember === 'on') ? 365 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        delete req.session.otp; delete req.session.tempUser; res.redirect('/');
    } else { res.render('otp', { error: 'Invalid OTP' }); }
});

app.post('/resend-otp', async (req, res) => {
    if (!req.session.tempUser) return res.status(401).json({ success: false });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    req.session.otp = otp;
    try { 
        await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { 
            recipient: ADMIN_EMAIL_RECEIVER, 
            subject: '🔄 New Code', 
            message: getEmailTemplate(otp, 'Resend') 
        }); 
        res.json({ success: true }); 
    } 
    catch (error) { res.status(500).json({ success: false }); }
});

app.get('/logout', (req, res) => { 
    req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/login'); }); 
});

// --- PAGES ---
app.get('/', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        let query = { status: 'pending' };
        let headerTitle = "All Pending";

        if (monthOffset !== 'all') {
            const { start, end, now } = getISTDate(monthOffset);
            const displayMonth = new Date(start);
            displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            query.verificationDate = { $gte: start, $lt: end, $lte: new Date(now.getTime() + 24*60*60*1000) };
            headerTitle = "Pending: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear();
        } else {
            const { now } = getISTDate(0);
            query.verificationDate = { $lte: new Date(now.getTime() + 24*60*60*1000) };
        }
        
        const fullCustomers = await fetchGroupedCustomers(query, { verificationDate: 1 });
        
        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

        res.render('index', { customers: paginatedCustomers, error: null, page: 'home', monthOffset, headerTitle, currentPage: page, totalPages });
    } catch (err) { res.render('index', { customers: [], error: "Connection Error", page: 'home', monthOffset: 0, headerTitle: "Error", currentPage: 1, totalPages: 1 }); }
});

app.get('/all', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        let query = {}; let headerTitle = "All History";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        if (monthOffset !== 'all') { 
            const { start, end } = getISTDate(monthOffset);
            query = { createdAt: { $gte: start, $lt: end } }; 
            
            const displayMonth = new Date(start);
            displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            headerTitle = "History: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear(); 
        }
        const fullCustomers = await fetchGroupedCustomers(query, { createdAt: -1 });

        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

        res.render('all', { customers: paginatedCustomers, page: 'all', monthOffset, headerTitle, currentPage: page, totalPages });
    } catch (err) { res.redirect('/'); }
});

// --- PDD ROUTE WITH ACTIVATION LOGIC ---
app.get('/pdd', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const customers = await fetchGroupedCustomers({ billDate: { $ne: null } }, { billDate: 1 });
        
        const today = new Date();
        const istNow = new Date(today.getTime() + (330 * 60000));
        const currentDay = istNow.getUTCDate();
        const currentMonth = istNow.getUTCMonth();
        const currentYear = istNow.getUTCFullYear();

        let pendingBills = [];

        customers.forEach(c => {
            let billYear = currentYear;
            let billMonth = currentMonth;

            if (currentDay <= c.billDate) {
                billMonth -= 1;
                if (billMonth < 0) {
                    billMonth = 11;
                    billYear -= 1;
                }
            }

            const actDate = new Date(c.activationDate || c.createdAt);
            const actIst = new Date(actDate.getTime() + (330 * 60000));
            const actYear = actIst.getUTCFullYear();
            const actMonth = actIst.getUTCMonth();
            const actDay = actIst.getUTCDate();

            const calcBillVal = billYear * 10000 + billMonth * 100 + c.billDate;
            const actVal = actYear * 10000 + actMonth * 100 + actDay;

            if (calcBillVal >= actVal) {
                const cycleKey = `${billYear}-${String(billMonth + 1).padStart(2, '0')}`;

                if (!c.paidMonths || !c.paidMonths.includes(cycleKey)) {
                    pendingBills.push({ ...c, cycleKey });
                }
            }
        });

        const totalPages = Math.ceil(pendingBills.length / ITEMS_PER_PAGE);
        const paginatedBills = pendingBills.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

        res.render('pdd', { pendingBills: paginatedBills, page: 'pdd', headerTitle: "PDD Tracking", currentPage: page, totalPages });
    } catch (err) { res.redirect('/'); }
});

app.get('/analytics', isAuthenticated, async (req, res) => {
    try {
        const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        let entryQuery = {}; 
        let headerTitle = "All Time Analysis";
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        const { now } = getISTDate(0);
        let start, end;
        
        if (monthOffset !== 'all') { 
            const dates = getISTDate(monthOffset);
            start = dates.start;
            end = dates.end;
            entryQuery = { createdAt: { $gte: start, $lt: end } }; 
            
            const displayMonth = new Date(start);
            displayMonth.setMinutes(displayMonth.getMinutes() + 330);
            headerTitle = "Analysis: " + monthNames[displayMonth.getMonth()] + " " + displayMonth.getFullYear();
        }
        const monthlyEntries = await Customer.find(entryQuery).sort({ activationDate: 1 }).lean();

        let activationQuery = {};
        if (monthOffset === 'all') {
            activationQuery = { activationDate: { $lte: now } };
        } else {
            activationQuery = { activationDate: { $gte: start, $lt: end, $lte: now } };
        }
        const monthlyActivations = await Customer.find(activationQuery);

        const stats = { 
            total: 0, activated: 0, runs: 0, 
            nc: 0, p2p: 0, mnp: 0, nmnp: 0, family: 0, 
            completed: 0, pending: 0 
        };

        monthlyEntries.forEach(c => {
            stats.total++; 
            if (c.status === 'completed') stats.completed++; else stats.pending++;

            if (c.subType === 'NC') stats.nc++;
            else if (c.subType === 'P2P') stats.p2p++;
            else if (c.subType === 'MNP') stats.mnp++;
            else if (c.subType === 'NMNP') stats.nmnp++;
            
            if (c.category === 'Family') stats.family++;

            if (c.category === 'Family' && c.familyRole === 'Secondary') {
                const pStatus = c.linkedPrimaryStatus || '';
                if (!pStatus.includes('Existing') && !pStatus.includes('Active')) {
                    const primaryDoc = monthlyEntries.find(p => p.category === 'Family' && p.familyRole === 'Primary' && p.mobile === c.linkedPrimaryNumber);
                    if (!primaryDoc) {
                        stats.total++;
                        stats.family++;
                        if (c.status === 'completed') stats.completed++; else stats.pending++;
                        if (pStatus.includes('NC')) stats.nc++;
                        else if (pStatus.includes('P2P')) stats.p2p++;
                        else if (pStatus.includes('MNP')) stats.mnp++;
                        else if (pStatus.includes('NMNP')) stats.nmnp++;
                    }
                }
            }
        });

        let realActivationCount = monthlyActivations.length;
        monthlyActivations.forEach(c => {
            let currentRun = getRuns(c.category, c.subType);
            stats.runs += currentRun;

            if (c.category === 'Family' && c.familyRole === 'Secondary') {
                const pStatus = c.linkedPrimaryStatus || '';
                if (!pStatus.includes('Existing') && !pStatus.includes('Active')) {
                    const primaryDoc = monthlyActivations.find(p => p.category === 'Family' && p.familyRole === 'Primary' && p.mobile === c.linkedPrimaryNumber);
                    if (!primaryDoc) {
                        realActivationCount++; 
                        let ghostType = 'NC'; 
                        if (pStatus.includes('MNP') || pStatus.includes('NMNP')) ghostType = 'MNP';
                        else if (pStatus.includes('P2P')) ghostType = 'P2P';
                        stats.runs += getRuns('Family', ghostType); 
                    }
                }
            }
        });

        stats.activated = realActivationCount;
        
        const pendingListRaw = monthlyEntries.filter(c => c.activationDate && c.activationDate > now);
        const pendingList = pendingListRaw.filter(c => !(c.category === 'Family' && c.familyRole === 'Primary'));
        
        res.render('analytics', { stats, pendingList, page: 'analytics', monthOffset, headerTitle });
    } catch (err) { res.redirect('/'); }
});

app.get('/manage', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const monthQuery = req.query.month; 
        let monthOffset = (monthQuery === 'all') ? 'all' : ((monthQuery === undefined) ? 0 : parseInt(monthQuery));
        let query = {}; let headerTitle = "Managing All Records";
        if (monthOffset !== 'all') { 
            const { start, end } = getISTDate(monthOffset);
            query = { createdAt: { $gte: start, $lt: end } }; 
        }
        const fullCustomers = await fetchGroupedCustomers(query, { createdAt: -1 });

        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

        res.render('manage', { customers: paginatedCustomers, page: 'manage', monthOffset, headerTitle, currentPage: page, totalPages });
    } catch (err) { res.redirect('/'); }
});

app.get('/search', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const q = req.query.q ? req.query.q.trim() : '';
        let fullCustomers = [];
        
        if (q) {
            const regex = new RegExp(q, 'i');
            const query = {
                $or: [
                    { name: regex },
                    { mobile: regex },
                    { linkedPrimaryNumber: regex },
                    { linkedPrimaryName: regex }
                ]
            };
            fullCustomers = await fetchGroupedCustomers(query, { createdAt: -1 });
        }
        
        const totalPages = Math.ceil(fullCustomers.length / ITEMS_PER_PAGE);
        const paginatedCustomers = fullCustomers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

        res.render('search', { customers: paginatedCustomers, query: q, page: 'search', headerTitle: "Global Search", currentPage: page, totalPages, totalItems: fullCustomers.length });
    } catch (err) {
        res.redirect('/');
    }
});

// --- STATE-PRESERVING POST ROUTES ---
app.post('/add', isAuthenticated, async (req, res) => {
    try {
        const { category, customDate, remarks, p_type, p_name, p_mobile, s_type, s_name, s_mobile, n_name, n_mobile, billDate } = req.body;
        const entryDate = customDate ? new Date(customDate) : new Date();
        const bDate = billDate ? parseInt(billDate) : null;

        if (category === 'Family') {
            if (p_type !== 'Existing') {
                const pLogic = calculateLogic(entryDate, p_type);
                const primaryCustomer = new Customer({
                    name: p_name, mobile: p_mobile, category: 'Family', subType: p_type, region: 'NA',
                    familyRole: 'Primary', linkedPrimaryName: 'Self', linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: 'Primary Account',
                    remarks: remarks || '', createdAt: entryDate, activationDate: pLogic.realActivationDate, verificationDate: pLogic.realVerificationDate, status: 'pending', billDate: bDate
                });
                await primaryCustomer.save();
            }
            const sLogic = calculateLogic(entryDate, s_type);
            const secondaryCustomer = new Customer({
                name: s_name, mobile: s_mobile, category: 'Family', subType: s_type, region: 'NA',
                familyRole: 'Secondary', linkedPrimaryName: p_name, linkedPrimaryNumber: p_mobile, linkedPrimaryStatus: `Type: ${p_type}`,
                remarks: remarks || '', createdAt: entryDate, activationDate: sLogic.realActivationDate, verificationDate: sLogic.realVerificationDate, status: 'pending', billDate: bDate
            });
            await secondaryCustomer.save();
        } else {
            const nLogic = calculateLogic(entryDate, category);
            const newCustomer = new Customer({
                name: n_name, mobile: n_mobile, category: category, subType: category, region: 'NA',
                familyRole: '', linkedPrimaryName: '', linkedPrimaryNumber: '', linkedPrimaryStatus: '',
                remarks: remarks || '', createdAt: entryDate, activationDate: nLogic.realActivationDate, verificationDate: nLogic.realVerificationDate, status: 'pending', billDate: bDate
            });
            await newCustomer.save();
        }
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); }
});

app.post('/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const { category, activationDate, remarks, p_type, p_name, p_mobile, s_type, s_name, s_mobile, n_name, n_mobile, billDate } = req.body;
        
        const userSelectedDate = new Date(activationDate);
        userSelectedDate.setHours(0,0,0,0);
        const bDate = billDate ? parseInt(billDate) : null;

        const existingDoc = await Customer.findById(req.params.id);
        if (existingDoc && existingDoc.category === 'Family' && existingDoc.familyRole === 'Secondary') {
            const oldPrimaryMobile = existingDoc.linkedPrimaryNumber;
            if (p_type !== 'Existing') {
                 const vDateP = new Date(userSelectedDate);
                 vDateP.setDate(vDateP.getDate() + 3);
                 await Customer.findOneAndUpdate(
                     { category: 'Family', familyRole: 'Primary', mobile: oldPrimaryMobile },
                     { name: p_name, mobile: p_mobile, subType: p_type, activationDate: userSelectedDate, verificationDate: vDateP, billDate: bDate }
                 );
            }
        }

        let updateData = { category, remarks, billDate: bDate };
        let finalSubType = category;

        if (category === 'Family') {
            updateData.name = s_name; updateData.mobile = s_mobile; updateData.subType = s_type; updateData.region = 'NA';
            updateData.familyRole = 'Secondary'; updateData.linkedPrimaryName = p_name; updateData.linkedPrimaryNumber = p_mobile; updateData.linkedPrimaryStatus = `Type: ${p_type}`;
            finalSubType = s_type;
        } else {
            updateData.name = n_name; updateData.mobile = n_mobile; updateData.subType = category; updateData.region = 'NA';
            updateData.familyRole = '';
            updateData.linkedPrimaryName = ''; updateData.linkedPrimaryNumber = ''; updateData.linkedPrimaryStatus = '';
            finalSubType = category;
        }

        updateData.activationDate = userSelectedDate;
        const vDate = new Date(userSelectedDate);
        if (finalSubType !== 'Existing') { vDate.setDate(vDate.getDate() + 3); }
        vDate.setHours(0,0,0,0);
        updateData.verificationDate = vDate;

        await Customer.findByIdAndUpdate(req.params.id, updateData);
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); }
});

app.post('/delete/:id', isAuthenticated, async (req, res) => { 
    try { 
        const doc = await Customer.findById(req.params.id);
        if(doc && doc.category === 'Family' && doc.familyRole === 'Secondary') {
            await Customer.findOneAndDelete({ category: 'Family', familyRole: 'Primary', mobile: doc.linkedPrimaryNumber });
        }
        await Customer.findByIdAndDelete(req.params.id); 
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); } 
});

app.post('/complete/:id', isAuthenticated, async (req, res) => { 
    try { 
        await Customer.findByIdAndUpdate(req.params.id, { status: 'completed' }); 
        safeRedirect(req, res);
    } catch (err) { safeRedirect(req, res); } 
});

app.post('/pay-bill/:id', isAuthenticated, async (req, res) => {
    try {
        const { cycleKey } = req.body;
        if(cycleKey) {
            const doc = await Customer.findById(req.params.id);
            if(doc && doc.category === 'Family' && doc.familyRole === 'Secondary') {
                await Customer.findOneAndUpdate(
                    { category: 'Family', familyRole: 'Primary', mobile: doc.linkedPrimaryNumber }, 
                    { $addToSet: { paidMonths: cycleKey }}
                );
            }
            await Customer.findByIdAndUpdate(req.params.id, {
                $addToSet: { paidMonths: cycleKey }
            });
        }
        safeRedirect(req, res);
    } catch(err) { safeRedirect(req, res); }
});

// --- PAY ALL BILLS ROUTE WITH ACTIVATION LOGIC ---
app.post('/pay-all-bills', isAuthenticated, async (req, res) => {
    try {
        const customers = await Customer.find({ billDate: { $ne: null } });
        
        const today = new Date();
        const istNow = new Date(today.getTime() + (330 * 60000));
        const currentDay = istNow.getUTCDate();
        const currentMonth = istNow.getUTCMonth();
        const currentYear = istNow.getUTCFullYear();

        const bulkOps = [];

        customers.forEach(c => {
            let billYear = currentYear;
            let billMonth = currentMonth;

            if (currentDay <= c.billDate) {
                billMonth -= 1;
                if (billMonth < 0) {
                    billMonth = 11;
                    billYear -= 1;
                }
            }

            const actDate = new Date(c.activationDate || c.createdAt);
            const actIst = new Date(actDate.getTime() + (330 * 60000));
            const actYear = actIst.getUTCFullYear();
            const actMonth = actIst.getUTCMonth();
            const actDay = actIst.getUTCDate();

            const calcBillVal = billYear * 10000 + billMonth * 100 + c.billDate;
            const actVal = actYear * 10000 + actMonth * 100 + actDay;

            if (calcBillVal >= actVal) {
                const cycleKey = `${billYear}-${String(billMonth + 1).padStart(2, '0')}`;

                if (!c.paidMonths || !c.paidMonths.includes(cycleKey)) {
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: c._id },
                            update: { $addToSet: { paidMonths: cycleKey } }
                        }
                    });
                    
                    if (c.category === 'Family' && c.familyRole === 'Secondary') {
                        bulkOps.push({
                            updateOne: {
                                filter: { category: 'Family', familyRole: 'Primary', mobile: c.linkedPrimaryNumber },
                                update: { $addToSet: { paidMonths: cycleKey } }
                            }
                        });
                    }
                }
            }
        });

        if (bulkOps.length > 0) {
            await Customer.bulkWrite(bulkOps);
        }
        
        safeRedirect(req, res);
    } catch(err) { 
        safeRedirect(req, res); 
    }
});

app.get('*', (req, res) => { res.redirect('/'); });

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    const PING_INTERVAL = 5 * 60 * 1000; 
    const TARGET_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    setInterval(async () => { try { await axios.get(`${TARGET_URL}/health`); console.log(`✅ Pinged ${TARGET_URL}`); } catch (err) { console.error(`❌ Ping Failed`); } }, PING_INTERVAL);
});