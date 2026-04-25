// middleware/auth.js
// =====================================================================
// STRICT AUTHENTICATION LOCK (IRON GATE)
// =====================================================================

const requireAuth = (req, res, next) => {
    // Check if session exists and user is marked as authenticated
    if (req.session && req.session.isAuthenticated) {
        return next(); // User is logged in, let them pass
    }

    // Agar request kisi API se aayi hai (fetch/ajax)
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.startsWith('/api/') || req.path.startsWith('/send-wa')) {
        console.warn(`[SECURITY] Blocked unauthorized API access attempt to: ${req.path} from IP: ${req.ip}`);
        return res.status(401).json({ 
            success: false, 
            msg: "Unauthorized! Please login to access this resource." 
        });
    }

    // Agar normal page request hai, toh login page par fek do
    res.redirect('/login');
};

// 🔥 FIX: Export isAuthenticated alias so old route files don't crash
requireAuth.isAuthenticated = requireAuth;

module.exports = requireAuth;