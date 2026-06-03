// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Setup standard secure local transporter execution configuration matrix
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.ADMIN_EMAIL_RECEIVER || 'samshaad365@gmail.com',
        pass: 'gulfam_app_passkey_token_here' // Replace with strict app-specific pass key codes profiles
    }
});

// Post Authentication Login Session Interceptor Validation Endpoint
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

        // Generate strong secure 6 digit numerical transaction security pin verification token array
        const secureCodeOtpPin = crypto.randomInt(100000, 999999).toString();
        
        // Cache variables trace inside core runtime memory session scope context structures layout
        req.session.otp = secureCodeOtpPin;
        req.session.username = username;

        console.log(`\n==============================================`);
        console.log(`🔑 SECURE TRANSACTION ACCESS TOKEN FOR SYSTEM: [ ${secureCodeOtpPin} ]`);
        console.log(`==============================================\n`);

        const mailTargetOptions = {
            from: `"VerifyHub Native Node Engine" <${process.env.ADMIN_EMAIL_RECEIVER || 'samshaad365@gmail.com'}>`,
            to: process.env.ADMIN_EMAIL_RECEIVER || 'samshaad365@gmail.com',
            subject: 'VerifyHub System Verification Access Challenge Token',
            text: `Authorized entry command registered. Secure Session Access Pin PIN: ${secureCodeOtpPin}`
        };

        // Fire asynchronous communication stack transaction pipeline elements
        transporter.sendMail(mailTargetOptions, (error, info) => {
            if (error) console.log("⚠️ Email Notification Relay Interface Dropout Error Logs:", error.message);
        });

        // 🔥 FIX PIPELINE JUMP LOCK: Blocks raw 302 web routing redirect cycles on native environments configurations matching loops
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.json({ success: true, message: "Handshake session challenge OTP dispatched successfully inside target terminal channels pool." });
        }

        res.redirect('/verify-otp');
    } catch (err) {
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.status(500).json({ success: false, error: "Critical internal system environment engine validation failure caught." });
        }
        res.render('login', { error: "System Runtime Crash Error Detected" });
    }
});

// Session token matching verification routine block context validation mapping schema
router.post('/verify-otp', (req, res) => {
    try {
        const { otp } = req.body;
        const currentCachedMemorySessionOtpValue = req.session.otp;

        if (otp && currentCachedMemorySessionOtpValue && otp.trim() === currentCachedMemorySessionOtpValue.trim()) {
            // Flush temporal token constraints arrays state pools mapping safely parameters
            req.session.otp = null;
            
            // Generate standard structural runtime authentication simulation dummy token mapping state values
            const systemSessionJwtTokenString = "vhub_secure_runtime_node_jwt_crypto_signed_token_layer_string";

            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.json({ success: true, token: systemSessionJwtTokenString, user: req.session.username });
            }
            res.redirect('/');
        } else {
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.status(403).json({ success: false, error: "The provided dynamic session PIN token mismatch verified error flags." });
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
