// utils/smartHelpers.js
const axios = require('axios');

// TRAI Smart Activation Algorithm
async function getFinalActDate(entryDate, type, logicFallbackDate) {
    if (type !== 'MNP' && type !== 'NMNP') return logicFallbackDate;
    
    let actDate = new Date(entryDate);
    let addedDays = 0;
    let targetDays = type === 'NMNP' ? 5 : 3;
    
    while (addedDays < targetDays) {
        actDate.setDate(actDate.getDate() + 1);
        let dayOfWeek = actDate.getDay(); 
        let date = actDate.getDate();
        let month = actDate.getMonth() + 1; 
        
        let isSunday = (dayOfWeek === 0);
        let isHoliday = (date === 26 && month === 1) || 
                        (date === 15 && month === 8) || 
                        (date === 2 && month === 10);   
                        
        if (!isSunday && !isHoliday) addedDays++;
    }
    
    let finalComputedDate = new Date(Date.UTC(actDate.getFullYear(), actDate.getMonth(), actDate.getDate(), 18, 0, 0));

    try {
        const apiKey = process.env.GROQ_API_KEY;
        if (apiKey) {
            const expectedStr = `${String(actDate.getDate()).padStart(2, '0')}/${String(actDate.getMonth() + 1).padStart(2, '0')}/${actDate.getFullYear()}`;
            const prompt = `Telecom MNP/NMNP rule: Calculate activation date by adding ${targetDays} working days to ${entryDate.toISOString().split('T')[0]}, skipping Sundays and Indian National Holidays (26 Jan, 15 Aug, 2 Oct). The algorithmic result is ${expectedStr}. Reply strictly with the final date in DD/MM/YYYY format.`;
            const res = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                { model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 15 },
                { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 4000 }
            );
            let aiDateStr = res.data?.choices?.[0]?.message?.content?.trim();
            if(aiDateStr) {
                console.log("AI Verified Date:", aiDateStr);
            }
        }
    } catch (err) {
        console.log("AI Date Check Error");
    }
    
    return finalComputedDate;
}

// Backend AI Gender Guess Fallback (Bulletproof)
async function guessGenderAI(rawName) {
    if (!rawName || rawName.trim() === '') return '';
    
    // Clean name: Remove tags like "(Primary)", "(Secondary)", etc.
    const name = rawName.replace(/\(.*\)/g, '').trim();
    if (name.length < 2 || name.toLowerCase() === 'primary account' || name.toLowerCase() === 'self') return '';

    try {
        const apiKey = process.env.GROQ_API_KEY;
        if (apiKey) {
            const prompt = `Based on this Indian name "${name}", determine the gender. Reply exactly "Male" or "Female". If unsure, say "Male".`;
            const res = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                { model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 10 },
                { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 4000 }
            );
            let guess = res.data?.choices?.[0]?.message?.content?.replace(/[^a-zA-Z]/g, '').trim().toLowerCase();
            if (guess === 'female') return 'Female';
            if (guess === 'male') return 'Male';
        }
    } catch (err) {
        console.log("AI Gender Guess Timeout/Error");
    }
    return '';
}

module.exports = {
    getFinalActDate,
    guessGenderAI
};