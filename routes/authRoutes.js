const express = require('express');
const router = express.Router();
const axios = require('axios');
const { loginLimiter, otpLimiter } = require('../middleware/auth');
const { getEmailTemplate } = require('../utils/helpers');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://localhost:5000';
const ADMIN_EMAIL_RECEIVER = process.env.ADMIN_EMAIL_RECEIVER || 'your-email@gmail.com';

router.get('/login', (req, res) => { 
    if (req.session.isLoggedIn) return res.redirect('/'); 
    res.render('login', { error: null }); 
});

router.post('/login', loginLimiter, async (req, res) => {
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

router.get('/otp', (req, res) => { 
    if (!req.session.otp) return res.redirect('/login'); 
    res.render('otp', { error: null }); 
});

router.post('/verify-otp', otpLimiter, (req, res) => {
    const { otp } = req.body;
    if (req.session.otp && otp.replace(/\s/g, '') === req.session.otp) {
        req.session.isLoggedIn = true; 
        req.session.cookie.maxAge = (req.session.tempUser.remember === 'on') ? 365 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        delete req.session.otp; delete req.session.tempUser; res.redirect('/');
    } else { res.render('otp', { error: 'Invalid OTP' }); }
});

router.post('/resend-otp', async (req, res) => {
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

router.get('/logout', (req, res) => { 
    req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/login'); }); 
});

module.exports = router;