const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    // Check for Android Native Auth Token Header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            // Verify access token with server runtime environment secret key
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey');
            req.user = decoded;
            req.session.isLoggedIn = true; // Sync flag state for server modules
            req.session.isAuthenticated = true;
            return next();
        } catch (err) {
            return res.status(401).json({ success: false, error: 'Token invalid or expired' });
        }
    }

    // Existing Web Cookie Session Fallback Rule
    if (req.session && (req.session.isLoggedIn || req.session.isAuthenticated)) {
        return next();
    }

    // Contextual Unauthorized Return Policy for REST pipelines
    if (req.headers['accept'] === 'application/json') {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    res.redirect('/login');
};
