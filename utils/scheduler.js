const cron = require('node-cron');
const axios = require('axios');
const Customer = require('../models/Customer');
const { getPayout } = require('./helpers');
const { sendAutoWaMessage } = require('./whatsapp');

const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://localhost:5000';
const ADMIN_EMAIL_RECEIVER = process.env.ADMIN_EMAIL_RECEIVER || 'your-email@gmail.com';
const ADMIN_WA_NUMBER = process.env.ADMIN_WA_NUMBER;
const PORT = process.env.PORT || 3000;

function startCronJobs() {
    console.log('⏳ Background Scheduler (Emails & WA Reports) Started...');

    // =========================================================================
    // 🔥 DAILY WHATSAPP KAMAI REPORT (CRON at 10:30 AM IST)
    // =========================================================================
    if (ADMIN_WA_NUMBER) {
        cron.schedule('30 10 * * *', async () => {
            console.log('⏳ Running Daily 10:30 AM WhatsApp Kamai Report...');
            try {
                const istNow = new Date(new Date().getTime() + (330 * 60000));
                const startOfMonth = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0) - (330*60000));
                const endOfMonth = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + 1, 0, 23, 59, 59, 999) - (330*60000));

                const allCustomers = await Customer.find().lean();
                let mnp_fam_c = 0, mnp_fam_r = 0; let other_fam_c = 0, other_fam_r = 0;
                let mnp_non_c = 0, mnp_non_r = 0; let fresh_non_c = 0, fresh_non_r = 0;
                let p2p_non_c = 0, p2p_non_r = 0;

                allCustomers.forEach(c => {
                    let cAct = new Date(c.activationDate || c.createdAt);
                    let isActThisMonth = (cAct >= startOfMonth && cAct <= endOfMonth);
                    let isActuallyActivated = (cAct <= istNow) || (c.status === 'completed');

                    if (isActThisMonth && isActuallyActivated) {
                        let earned = 0;
                        try { earned = getPayout(c.category, c.subType, c.plan) || 0; } catch(e) {}

                        let type = c.category; let sub = c.subType || c.category;

                        if (c.category === 'Family' && c.familyRole === 'Secondary') {
                            const pStatus = c.linkedPrimaryStatus || '';
                            if (!pStatus.includes('Existing') && !pStatus.includes('Active')) {
                                const primaryDoc = allCustomers.find(p => p.category === 'Family' && p.familyRole === 'Primary' && p.mobile === c.linkedPrimaryNumber);
                                if (!primaryDoc) {
                                    let ghostType = 'NC';
                                    if (pStatus.includes('NMNP')) ghostType = 'NMNP'; else if (pStatus.includes('MNP')) ghostType = 'MNP'; else if (pStatus.includes('P2P')) ghostType = 'P2P';
                                    else if (pStatus.includes('PDR')) ghostType = 'PDR';
                                    let ghostEarned = 0;
                                    try { ghostEarned = getPayout('Family', ghostType, c.plan) || 0; } catch(e){}
                                    if (ghostType === 'MNP' || ghostType === 'NMNP') { mnp_fam_c++; mnp_fam_r += ghostEarned; } else { other_fam_c++; other_fam_r += ghostEarned; }
                                }
                            }
                        }

                        if (type === 'Family') {
                            if (sub === 'MNP' || sub === 'NMNP') { mnp_fam_c++; mnp_fam_r += earned; } else if (sub !== 'Existing') { other_fam_c++; other_fam_r += earned; }
                        } else if (type === 'MNP' || type === 'NMNP') { mnp_non_c++; mnp_non_r += earned;
                        } else if (type === 'NC') { fresh_non_c++; fresh_non_r += earned;
                        } else if (type === 'P2P' || type === 'PDR') { p2p_non_c++; p2p_non_r += earned; }
                    }
                });
                
                let total_c = mnp_fam_c + other_fam_c + mnp_non_c + fresh_non_c + p2p_non_c;
                let total_r = mnp_fam_r + other_fam_r + mnp_non_r + fresh_non_r + p2p_non_r;
                let todayStr = istNow.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

                let waMsg = `*💰 MERI KAMAI REPORT* 💰\n_Date: ${todayStr}_\n\n*📊 KPI / Gross / Incentive*\n------------------------\n📱 MNP FAMILY: ${mnp_fam_c} / ₹${mnp_fam_r}\n👨‍👩‍👧 OTHER FAMILY: ${other_fam_c} / ₹${other_fam_r}\n🔄 MNP NON-FAMILY: ${mnp_non_c} / ₹${mnp_non_r}\n🆕 FRESH NON-FAMILY: ${fresh_non_c} / ₹${fresh_non_r}\n🔁 P2P NON-FAMILY: ${p2p_non_c} / ₹${p2p_non_r}\n------------------------\n*✅ TOTAL GROSS:* ${total_c}\n*💸 TOTAL INCENTIVE:* ₹${total_r}`;

                let cleanNumber = ADMIN_WA_NUMBER.toString().replace(/^91/, '');
                const sent = await sendAutoWaMessage(cleanNumber, waMsg);
                if(sent) console.log(`✅ Daily Kamai sent to WhatsApp: ${cleanNumber}`);

            } catch (err) {
                console.error('❌ Cron WA Kamai Error:', err.message);
            }
        }, { timezone: "Asia/Kolkata" });
    }

    // =========================================================================
    // 🔥 INTERVAL BASED EMAIL ALERTS (10 AM & 11 AM) + HEALTH PING
    // =========================================================================
    const PING_INTERVAL = 5 * 60 * 1000; 
    const TARGET_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    
    global.lastDailyEmail = null;
    global.lastKamaiEmail = null; 

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
                <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
                <body style="margin: 0; padding: 0; background-color: #f4f7f6; font-family: 'Segoe UI', sans-serif;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f7f6; padding: 20px;">
                        <tr><td align="center">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
                                <tr><td style="background: linear-gradient(135deg, #10b981, #059669); padding: 30px 20px; text-align: center;"><h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 1px;">VerifyHub Daily Alert</h1></td></tr>
                                <tr><td style="padding: 40px 30px; text-align: center;">
                                    <h2 style="margin: 0 0 20px 0; color: #1e293b; font-size: 22px;">Good Morning, Admin! ☀️</h2>
                                    <div style="background-color: #fffbeb; border: 1px solid #fde68a; padding: 25px; border-radius: 12px; margin-bottom: 25px;">
                                        <span style="font-size: 42px; font-weight: 800; color: #d97706; display: block; margin-bottom: 5px; line-height: 1;">${pendingCount}</span>
                                        <span style="font-size: 15px; font-weight: 600; color: #92400e;">Pending Tasks For Today</span>
                                    </div>
                                    <p style="margin: 0; color: #64748b; font-size: 15px; line-height: 1.6;">Aapke dashboard par <b>${pendingCount}</b> forms activation ya verification ke liye pending hain.</p>
                                </td></tr>
                            </table>
                        </td></tr>
                    </table>
                </body>
                </html>`;
                await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { recipient: ADMIN_EMAIL_RECEIVER, subject: `Daily Alert: ${pendingCount} Pending Tasks`, message: msg });
            }

            if (hours === 11 && global.lastKamaiEmail !== todayStr) {
                global.lastKamaiEmail = todayStr;
                const startOfMonth = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0) - (330*60000));
                const endOfMonth = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + 1, 0, 23, 59, 59, 999) - (330*60000));

                const allCustomers = await Customer.find().lean();
                let mnp_fam_c = 0, mnp_fam_r = 0; let other_fam_c = 0, other_fam_r = 0;
                let mnp_non_c = 0, mnp_non_r = 0; let fresh_non_c = 0, fresh_non_r = 0;
                let p2p_non_c = 0, p2p_non_r = 0;

                allCustomers.forEach(c => {
                    let cAct = new Date(c.activationDate || c.createdAt);
                    let isActThisMonth = (cAct >= startOfMonth && cAct <= endOfMonth);
                    let isActuallyActivated = (cAct <= istNow) || (c.status === 'completed');

                    if (isActThisMonth && isActuallyActivated) {
                        let earned = 0;
                        try { earned = getPayout(c.category, c.subType, c.plan) || 0; } catch(e) {}

                        let type = c.category; let sub = c.subType || c.category;

                        if (c.category === 'Family' && c.familyRole === 'Secondary') {
                            const pStatus = c.linkedPrimaryStatus || '';
                            if (!pStatus.includes('Existing') && !pStatus.includes('Active')) {
                                const primaryDoc = allCustomers.find(p => p.category === 'Family' && p.familyRole === 'Primary' && p.mobile === c.linkedPrimaryNumber);
                                if (!primaryDoc) {
                                    let ghostType = 'NC';
                                    if (pStatus.includes('NMNP')) ghostType = 'NMNP'; else if (pStatus.includes('MNP')) ghostType = 'MNP'; else if (pStatus.includes('P2P')) ghostType = 'P2P';
                                    else if (pStatus.includes('PDR')) ghostType = 'PDR';
                                    let ghostEarned = 0;
                                    try { ghostEarned = getPayout('Family', ghostType, c.plan) || 0; } catch(e){}
                                    if (ghostType === 'MNP' || ghostType === 'NMNP') { mnp_fam_c++; mnp_fam_r += ghostEarned; } else { other_fam_c++; other_fam_r += ghostEarned; }
                                }
                            }
                        }

                        if (type === 'Family') {
                            if (sub === 'MNP' || sub === 'NMNP') { mnp_fam_c++; mnp_fam_r += earned; } else if (sub !== 'Existing') { other_fam_c++; other_fam_r += earned; }
                        } else if (type === 'MNP' || type === 'NMNP') { mnp_non_c++; mnp_non_r += earned;
                        } else if (type === 'NC') { fresh_non_c++; fresh_non_r += earned;
                        } else if (type === 'P2P' || type === 'PDR') { p2p_non_c++; p2p_non_r += earned; }
                    }
                });
                let total_c = mnp_fam_c + other_fam_c + mnp_non_c + fresh_non_c + p2p_non_c;
                let total_r = mnp_fam_r + other_fam_r + mnp_non_r + fresh_non_r + p2p_non_r;
                let kamaiMsg = `
                <!DOCTYPE html>
                <html>
                <body style="margin: 0; padding: 20px; background-color: #f4f7f6; font-family: monospace; font-size: 16px;">
                    <div style="background-color: #ffffff; padding: 25px; border-radius: 8px; border: 1px solid #e2e8f0; color: #0f172a; max-width: 450px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                        <div style="color: #10b981; font-size: 22px; font-weight: bold; margin-bottom: 5px;">Meri Kamai</div>
                        <div style="font-weight: bold; border-bottom: 2px dashed #cbd5e1; padding-bottom: 12px; margin-bottom: 15px; color: #475569;">KPI/Gross/Incentive<br>ShamsadAlam</div>
                        <div style="line-height: 2.2; font-size: 16px; color: #1e293b;">
                            <div>MNP_FAMILY:/${mnp_fam_c}/${mnp_fam_r}</div><div>OTHER_FAMILY:/${other_fam_c}/${other_fam_r}</div><div>MNP_NON_FAMILY:/${mnp_non_c}/${mnp_non_r}</div><div>FRESH_NON_FAMILY:/${fresh_non_c}/${fresh_non_r}</div><div>P2P_NON_FAMILY:/${p2p_non_c}/${p2p_non_r}</div>
                        </div>
                        <div style="margin-top: 15px; border-top: 2px dashed #cbd5e1; padding-top: 15px; font-weight: bold; color: #059669; font-size: 18px;">TOTAL_GROSS_INCENTIVE:/${total_c}/${total_r}</div>
                    </div>
                </body>
                </html>`;

                await axios.post(`${EMAIL_SERVICE_URL}/send-email`, { recipient: ADMIN_EMAIL_RECEIVER, subject: `Meri Kamai Report`, message: kamaiMsg });
            }
        } catch (err) {} 
    }, PING_INTERVAL);
}

module.exports = { startCronJobs };