// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { sendAutoWaMessage } = require('../utils/whatsapp'); // WhatsApp helper

// Fix infinite redirect loop issue
router.get('/login', (req, res) => {
    if (req.session && (req.session.isLoggedIn || req.session.isAuthenticated)) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
});

router.get('/verify-otp', (req, res) => {
    if (!req.session.otp) {
        return res.redirect('/login');
    }
    res.render('otp', { error: null });
});

router.get('/logout', (req, res) => {
    if (req.session) {
        req.session.destroy(() => {
            res.redirect('/login');
        });
    } else {
        res.redirect('/login');
    }
});

// Post Authentication Login Session Interceptor
router.post('/login', async (req, res) => {
    try {
        const { username, Vpassword } = req.body;
        const rootAdminUser = process.env.ADMIN_USERNAME || 'samshaad365';
        const rootAdminPass = process.env.ADMIN_PASSWORD || 'Gulfam@2002';

        if (username !== rootAdminUser || Vpassword !== rootAdminPass) {
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.status(401).json({ success: false, error: "Invalid master user identifier entries rejected." });
            }
            return res.render('login', { error: "Invalid Credentials Mapping" });
        }

        // Generate strong secure 6 digit numerical pin
        const secureCodeOtpPin = crypto.randomInt(100000, 999999).toString();
        
        req.session.otp = secureCodeOtpPin;
        req.session.username = username;

        console.log(`\n==============================================`);
        console.log(`🔑 SECURE TRANSACTION ACCESS TOKEN: [ ${secureCodeOtpPin} ]`);
        console.log(`==============================================\n`);

        // --- BACKGROUND WA OTP SENDING ---
        const adminWaNum = process.env.ADMIN_WA_NUMBER || '8657973703';
        const waMsg = `🔑 *VerifyHub Secure Login*\n\nYour Admin OTP is: *${secureCodeOtpPin}*\n\nDo not share this PIN.`;
        
        sendAutoWaMessage(adminWaNum, waMsg).catch(e => {
            console.log(`⚠️ WA Message Skipped (Bot Offline/Restarting): ${e.message}`);
        });

        // --- BULLETPROOF BACKGROUND EMAIL API CALL (TEMPLATE TRIGGER PAYLOAD) ---
        const sendBackgroundEmail = async () => {
            let emailApiUrl = process.env.EMAIL_API_URL || 'https://email-testtt.vercel.app/api/send-email';
            const emailApiKey = process.env.VERCEL_EMAIL_API_KEY || 'your_vercel_api_key_here';
            const targetEmail = process.env.ADMIN_EMAIL_RECEIVER || 'samshaad365@gmail.com';

            if (!emailApiKey || emailApiKey === 'your_vercel_api_key_here') {
                console.log(`\n🚨 [EMAIL JOB] STOPPED: VERCEL_EMAIL_API_KEY is missing!`);
                return;
            }

            if (!emailApiUrl.includes('send-email')) {
                emailApiUrl = emailApiUrl.endsWith('/') ? emailApiUrl + 'api/send-email' : emailApiUrl + '/api/send-email';
            }

            // TRIGGER PAYLOAD: Sending explicit variable maps to trigger internal templates safely
            const emailPayload = {
                to: targetEmail,
                recipient: targetEmail,
                subject: 'VerifyHub System Verification Access Challenge Token',
                otp: secureCodeOtpPin,     
                type: 'otp',               
                template: 'otp',           
                action: 'otp',             
                pin: secureCodeOtpPin      
            };

            console.log(`\n⏳ [EMAIL JOB] Sending template triggers to: ${emailApiUrl}`);

            try {
                const response = await fetch(emailApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${emailApiKey}`
                    },
                    body: JSON.stringify(emailPayload)
                });

                const responseText = await response.text();

                if (response.ok) {
                    console.log(`✅ [EMAIL JOB] API Hit Success! Response: ${responseText}\n`);
                } else if (response.status === 401) {
                    console.log(`\n❌ [EMAIL JOB] Authentication Failed! (HTTP 401)`);
                } else {
                    console.log(`❌ [EMAIL JOB] Failed: HTTP ${response.status} - ${responseText}\n`);
                }
            } catch (error) {
                console.log(`\n🚨 [EMAIL JOB] ERROR: ${error.message}\n`);
            }
        };

        sendBackgroundEmail();
        // ----------------------------------------------------------------------

        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.json({ success: true, message: "OTP Dispatched." });
        }

        res.redirect('/verify-otp');
    } catch (err) {
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.status(500).json({ success: false, error: "Validation failure caught." });
        }
        res.render('login', { error: "System Runtime Crash Error Detected" });
    }
});

// Session token verification routine
router.post('/verify-otp', (req, res) => {
    try {
        const { otp } = req.body;
        const currentCachedMemorySessionOtpValue = req.session.otp;

        if (otp && currentCachedMemorySessionOtpValue && otp.trim() === currentCachedMemorySessionOtpValue.trim()) {
            req.session.otp = null;
            req.session.isLoggedIn = true;
            req.session.isAuthenticated = true;
            
            const systemSessionJwtTokenString = "vhub_secure_runtime_node_jwt_crypto_signed_token_layer_string";

            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.json({ success: true, token: systemSessionJwtTokenString, user: req.session.username });
            }
            res.redirect('/');
        } else {
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.status(403).json({ success: false, error: "Token mismatch." });
            }
            res.render('otp', { error: "Verification Access Code PIN Failed Check Validation." });
        }
    } catch (err) {
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.status(500).json({ success: false });
        }
        res.redirect('/login');
    }
});

module.exports = router;
