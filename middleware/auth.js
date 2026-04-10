const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 5, message: "Too many login attempts." });
const otpLimiter = rateLimit({ windowMs: 10*60*1000, max: 10, message: "Too many OTP attempts." });

const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.isLoggedIn) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return next();
    }
    if (req.xhr) return res.status(401).json({ success: false, message: 'Unauthorized' });
    res.redirect('/login');
};

module.exports = { loginLimiter, otpLimiter, isAuthenticated };