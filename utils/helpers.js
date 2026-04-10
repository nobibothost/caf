const Customer = require('../models/Customer');

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

function getISTDate(offsetMonths = 0) {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const nd = new Date(utc + (3600000 * 5.5)); 
    
    let targetYear = nd.getFullYear();
    let targetMonth = nd.getMonth() - offsetMonths;
    while(targetMonth < 0) { targetMonth += 12; targetYear -= 1; }

    const start = new Date(Date.UTC(targetYear, targetMonth, 1));
    start.setHours(start.getHours() - 5);
    start.setMinutes(start.getMinutes() - 30);
    
    const end = new Date(Date.UTC(targetYear, targetMonth + 1, 1));
    end.setHours(end.getHours() - 5);
    end.setMinutes(end.getMinutes() - 30);

    return { start, end, now: new Date() }; 
}

function parseISTDateString(dateStr) {
    if (!dateStr) {
        const d = new Date();
        const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
        const nd = new Date(utc + (3600000 * 5.5));
        return new Date(Date.UTC(nd.getFullYear(), nd.getMonth(), nd.getDate()));
    }
    
    let parsedDate;
    if (dateStr.includes('/')) {
        const [d, m, y] = dateStr.split('/');
        parsedDate = new Date(Date.UTC(y, m - 1, d));
    } else {
        const [y, m, d] = dateStr.split('-');
        parsedDate = new Date(Date.UTC(y, m - 1, d));
    }
    return parsedDate; 
}

function getRuns(category, subType) {
    if (category === 'Family') {
        if (subType === 'MNP' || subType === 'NMNP') return 3; 
        if (subType === 'P2P') return 2; 
        return 1; 
    } else {
        if (subType === 'MNP' || subType === 'NMNP') return 2; 
        return 1; 
    }
}

function getPayout(category, subType, plan) {
    const isMNP = (subType === 'MNP' || subType === 'NMNP');
    if (category === 'Family') {
        return isMNP ? 120 : 60;
    } else {
        if (plan === '1201 RedEx' || plan === '1201') return isMNP ? 400 : 200;
        if (plan === '751') return isMNP ? 200 : 100;
        if (plan === '551') return isMNP ? 150 : 75;
        return isMNP ? 70 : 35;
    }
}

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

function calculateLogic(baseDate, type) {
    const activationDelay = RULES.ACTIVATION_DELAY[type] !== undefined ? RULES.ACTIVATION_DELAY[type] : 0;
    const realActivationDate = new Date(baseDate);
    realActivationDate.setUTCDate(realActivationDate.getUTCDate() + activationDelay);
    realActivationDate.setUTCHours(0,0,0,0);

    const realVerificationDate = new Date(realActivationDate);
    if (type !== 'Existing') {
        realVerificationDate.setUTCDate(realVerificationDate.getUTCDate() + RULES.VERIFICATION_DELAY);
    }
    realVerificationDate.setUTCHours(0,0,0,0);
    return { realActivationDate, realVerificationDate };
}

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
    } else if (sortObj && sortObj.activationDate) {
         result.sort((a, b) => {
            const dateA = a.activationDate || a.createdAt;
            const dateB = b.activationDate || b.createdAt;
            return sortObj.activationDate === 1 ? dateA - dateB : dateB - dateA;
        });
    }

    return result;
}

const safeRedirect = (req, res) => {
    const returnUrl = req.body.returnUrl;
    if (returnUrl && returnUrl.startsWith('/')) {
        return res.redirect(returnUrl);
    }
    return res.redirect('back');
};

module.exports = {
    RULES, getISTDate, parseISTDateString, getRuns, getPayout,
    getEmailTemplate, calculateLogic, fetchGroupedCustomers, safeRedirect
};