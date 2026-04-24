const express = require('express');
const router = express.Router();
const axios = require('axios');
const Customer = require('../models/Customer');
const { isAuthenticated } = require('../middleware/auth');

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function callAI(promptText) {
    const groqKey = process.env.GROQ_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (groqKey) {
        try {
            const res = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                { model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: promptText }], temperature: 0.7, max_tokens: 200 },
                { headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' }, timeout: 8000 }
            );
            const text = res.data?.choices?.[0]?.message?.content?.trim();
            if (text) return text;
        } catch (err) { console.log("⚠️ Groq failed:", err.response?.data || err.message); }
    }

    await delay(500);

    if (openRouterKey) {
        try {
            const res = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                { model: 'mistralai/mistral-7b-instruct', messages: [{ role: 'user', content: promptText }] },
                { headers: { Authorization: `Bearer ${openRouterKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Telecom Dashboard' }, timeout: 8000 }
            );
            const text = res.data?.choices?.[0]?.message?.content?.trim();
            if (text) return text;
        } catch (err) { console.log("❌ OpenRouter failed:", err.response?.data || err.message); }
    }
    return "System busy.";
}

// Enhance Remarks
router.post('/enhance-remarks', isAuthenticated, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.json({ success: false, suggestions: [] });
        const prompt = `Convert the following rough note into exactly TWO professional and clear action summaries (remarks) for a telecom verification dashboard in Hinglish only. The format should reflect 'what the task was and what action was taken' (e.g., "Customer se bill ke liye baat ki, usne kal ka time diya hai"). Keep each to 1 sentence. \n\nIMPORTANT RULE: Separate the two options strictly with the symbol "|||" and do NOT add any numbers, bullet points, or extra text.\n\nRough Note: "${text}"`;
        const aiResponse = await callAI(prompt);
        let suggestionsList = aiResponse.split('|||').map(s => s.trim()).filter(s => s);
        
        if (suggestionsList.length === 1) {
             suggestionsList = aiResponse.split('\n').map(s => s.replace(/^[0-9\-\.\*]+\s*/, '').trim()).filter(s => s).slice(0, 2);
        }
        if (suggestionsList.length === 0) suggestionsList = ["Network error, please try again."];
        res.json({ success: true, suggestions: suggestionsList });
    } catch (err) { res.status(500).json({ success: false, suggestions: ["Failed to process. Try again."] }); }
});

// Guess Gender
router.post('/guess-gender', isAuthenticated, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.json({ success: false, gender: "" });

        const prompt = `Based on this Indian name "${name}", determine the gender. Reply with exactly one word: "Male" or "Female". If unsure, say "Unknown". No other text.`;
        const aiResponse = await callAI(prompt);
        
        let guess = aiResponse.replace(/[^a-zA-Z]/g, '').trim().toLowerCase();
        
        if (guess === 'female') {
            res.json({ success: true, gender: 'Female' });
        } else if (guess === 'male') {
            res.json({ success: true, gender: 'Male' });
        } else {
            res.json({ success: false, error: 'Uncertain' });
        }
    } catch (err) { res.status(500).json({ success: false }); }
});

// Daily Plan
router.get('/daily-plan', isAuthenticated, async (req, res) => {
    try {
        const today = new Date();
        const istNow = new Date(today.getTime() + (330 * 60000));
        const utcEndOfDay = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 23, 59, 59, 999) - (330 * 60000));

        const pendingVerifications = await Customer.countDocuments({ status: 'pending', subType: { $nin: ['Existing', 'existing', 'EXISTING', ' Existing', 'Existing '] }, category: { $nin: ['Existing', 'existing', 'EXISTING'] }, verificationDate: { $lte: utcEndOfDay } });
        const prompt = `I have ${pendingVerifications} pending verifications. Give me a short 2-line Hinglish action plan to prioritize and complete them today.`;
        const aiResponse = await callAI(prompt);
        res.json({ success: true, plan: aiResponse });
    } catch (err) { res.status(500).json({ success: false, plan: "Start strong. Clear today's pending tasks first." }); }
});

module.exports = router;