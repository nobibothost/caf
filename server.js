require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const axios = require('axios');
const helmet = require('helmet');

// --- Import Modular Routes & Models ---
const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const Customer = require('./models/Customer');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://localhost:5000';
const ADMIN_EMAIL_RECEIVER = process.env.ADMIN_EMAIL_RECEIVER || 'your-email@gmail.com';
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecretkey';
const MONGO_URI = process.env.MONGO_URI;

// --- MIDDLEWARE ---
app.use(helmet({ 
    contentSecurityPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

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

app.use('/', authRoutes);
app.use('/', customerRoutes);

app.get('*', (req, res) => { res.redirect('/'); });

// --- SERVER & DAILY CRON JOBS ---
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    const PING_INTERVAL = 5 * 60 * 1000; 
    const TARGET_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    
    global.lastDailyEmail = null;

    setInterval(async () => { 
        try { 
            await axios.get(`${TARGET_URL}/health`);
            
            const istNow = new Date(new Date().getTime() + (330 * 60000));
            const hours = istNow.getUTCHours();
            const todayStr = istNow.toISOString().split('T')[0];

            if (hours === 10 && global.lastDailyEmail !== todayStr) {
                global.lastDailyEmail = todayStr;
                
                const pendingCount = await Customer.countDocuments({ status: 'pending', activationDate: { $lte: new Date(istNow.getTime() - (330*60000)) } });
                
                let msg = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                </head>
                <body style="margin: 0; padding: 0; background-color: #f4f7f6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                    <div style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
                        🔔 Daily Alert: Aaj aapke paas ${pendingCount} forms pending hain complete karne ke liye.
                    </div>
                    
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f7f6; padding: 20px;">
                        <tr>
                            <td align="center">
                                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
                                    <tr>
                                        <td style="background: linear-gradient(135deg, #10b981, #059669); padding: 30px 20px; text-align: center;">
                                            <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 1px;">VerifyHub Daily Alert</h1>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 40px 30px; text-align: center;">
                                            <h2 style="margin: 0 0 20px 0; color: #1e293b; font-size: 22px;">Good Morning, Admin! ☀️</h2>
                                            
                                            <div style="background-color: #fffbeb; border: 1px solid #fde68a; padding: 25px; border-radius: 12px; margin-bottom: 25px;">
                                                <span style="font-size: 42px; font-weight: 800; color: #d97706; display: block; margin-bottom: 5px; line-height: 1;">${pendingCount}</span>
                                                <span style="font-size: 15px; font-weight: 600; color: #92400e;">Pending Tasks For Today</span>
                                            </div>
                                            
                                            <p style="margin: 0; color: #64748b; font-size: 15px; line-height: 1.6;">
                                                Aapke dashboard par <b>${pendingCount}</b> forms activation ya verification ke liye pending hain. Kripya login karke inhe complete karein aur apni revenue secure karein.
                                            </p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="background-color: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
                                            &copy; ${new Date().getFullYear()} VerifyHub System<br>Automated Daily Report
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>`;
                
                await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { 
                    recipient: ADMIN_EMAIL_RECEIVER, 
                    subject: `Daily Alert: ${pendingCount} Pending Tasks`, 
                    message: msg 
                });
            }
        } catch (err) {} 
    }, PING_INTERVAL);
});