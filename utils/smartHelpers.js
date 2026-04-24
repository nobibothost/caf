// utils/smartHelpers.js
const axios = require('axios');

// TRAI Smart Activation Algorithm
async function getFinalActDate(entryDate, type, logicFallbackDate) {
    if (type !== 'MNP' && type !== 'NMNP') return logicFallbackDate;
    
    let actDate = new Date(entryDate);
    let addedDays = 0;
    
    while (addedDays < 3) {
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
    return new Date(Date.UTC(actDate.getFullYear(), actDate.getMonth(), actDate.getDate(), 18, 0, 0));
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