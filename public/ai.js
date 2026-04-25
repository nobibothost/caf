// public/ai.js
const aiStyle = document.createElement('style');
aiStyle.innerHTML = `
    @keyframes fadeInAi { from { opacity: 0; transform: translateY(-20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @keyframes popInAi { 0% { opacity: 0; transform: translateY(-20px); } 100% { opacity: 1; transform: translateY(0); } }
    @keyframes popOutAi { 0% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-20px); } }
    @keyframes shakeAiBtn { 0%, 100% { transform: translateY(-50%) translateX(0); } 25% { transform: translateY(-50%) translateX(-4px); } 75% { transform: translateY(-50%) translateX(4px); } }
    
    .ai-modal-overlay button:last-child { border-bottom: none !important; }
    
    .ai-inline-btn {
        position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
        background: #ffffff; border: 1px solid #ede9fe; cursor: pointer;
        font-size: 1.2rem; color: #8b5cf6; padding: 4px 6px; border-radius: 6px;
        outline: none; transition: all 0.2s ease; z-index: 10;
        display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.02); height: calc(100% - 12px); max-height: 32px;
    }
    .ai-inline-btn:hover { background: #f5f3ff; transform: translateY(-50%) scale(1.05); }
    
    /* 🔥 Android 4 Top-Right Position */
    #ai-toast-container {
        position: fixed;
        top: 75px; right: 20px; z-index: 999999;
        display: flex; flex-direction: column; gap: 10px; align-items: flex-end; pointer-events: none;
    }
    
    /* 🔥 Android 4 Pill Shaped Dark Theme */
    .ai-toast-msg {
        background: rgba(50, 50, 50, 0.95); color: white;
        padding: 10px 20px; border-radius: 24px;
        box-shadow: none; font-size: 0.9rem; font-weight: 500;
        display: flex; align-items: center; gap: 8px;
        animation: popInAi 0.3s ease-out forwards;
    }
`;
document.head.appendChild(aiStyle);

const toastContainer = document.createElement('div');
toastContainer.id = 'ai-toast-container';
document.body.appendChild(toastContainer);

window.showAIToast = function(msg, isSuccess = true) {
    const toast = document.createElement('div');
    toast.className = `ai-toast-msg`;
    toast.innerHTML = isSuccess ? `<i class="ri-check-line" style="font-size:1.1rem; color:#4ade80;"></i> ${msg}` : `<i class="ri-error-warning-line" style="font-size:1.1rem; color:#f87171;"></i> ${msg}`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'popOutAi 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// 🔥 SMART ISOLATED AI GENDER TRIGGER (Works for Primary & Existing)
document.addEventListener('blur', function(e) {
    if (!e.target || !e.target.name) return;
    
    let targetSelectName = null;
    if (e.target.name === 'n_name') targetSelectName = 'gender';
    else if (e.target.name === 'p_name') targetSelectName = 'p_gender';
    else if (e.target.name === 's_name') targetSelectName = 's_gender';
    
    if (targetSelectName) {
        let parentContainer = e.target.closest('.form-section') || e.target.closest('.secondary-row');
        if (parentContainer) {
            let selectElem = parentContainer.querySelector(`select[name="${targetSelectName}"]`);
            if (selectElem) {
                window.triggerGenderAI(e.target, selectElem);
            }
        }
    }
}, true);

window.triggerGenderAI = async function(inputElem, selectElem) {
    let rawName = inputElem.value.trim();
    // Clean name to remove brackets like (Primary) so AI isn't confused
    let name = rawName.replace(/\(.*\)/g, '').trim();
    if (!name || name.length < 2 || name.toLowerCase() === 'primary account' || name.toLowerCase() === 'self') return;
    // Only fetch if dropdown is on Auto/KEEP or Empty
    if (selectElem.value !== 'KEEP' && selectElem.value !== '') return;

    const originalBorder = inputElem.style.borderColor;
    inputElem.style.borderColor = '#8b5cf6'; 

    try {
        const res = await fetch('/api/ai/guess-gender', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        const data = await res.json();
        
        if (data.success && data.gender) {
            selectElem.value = data.gender;
            window.showAIToast(`AI: ${data.gender} selected for ${name}`, true);
        } else {
            window.showAIToast(`AI Failed. Left as Auto.`, false);
        }
    } catch (e) {
        window.showAIToast(`Network Error. Left as Auto.`, false);
    } finally {
        inputElem.style.borderColor = originalBorder;
    }
};

window.showAiSuggestions = async function(inputElement, btnElement, e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const text = inputElement.value.trim();
    if (!text) {
        btnElement.style.animation = 'shakeAiBtn 0.4s ease';
        setTimeout(() => btnElement.style.animation = '', 400);
        return;
    }
    const existingOverlay = document.querySelector('.ai-modal-overlay');
    if (existingOverlay) existingOverlay.remove();
    
    const originalIcon = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="ri-loader-4-line spin-loader" style="color:#8b5cf6;"></i>';
    btnElement.disabled = true;

    try {
        const res = await fetch('/api/ai/enhance-remarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });
        const data = await res.json();
        btnElement.innerHTML = originalIcon;
        btnElement.disabled = false;

        if (data.success && data.suggestions && data.suggestions.length > 0) {
            const overlay = document.createElement('div');
            overlay.className = 'ai-modal-overlay';
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15, 23, 42, 0.6); z-index:99999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px);';
            
            const popup = document.createElement('div');
            popup.style.cssText = 'background:#ffffff; width:90%; max-width:400px; border-radius:12px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); overflow:hidden; animation:fadeInAi 0.2s ease-out;';
            
            const header = document.createElement('div');
            header.innerHTML = '<span style="display:flex; gap:6px; align-items:center;"><i class="ri-sparkling-fill"></i> Select a Suggestion</span> <button type="button" class="close-ai-btn" style="background:transparent; border:none; color:#6d28d9; font-size:1.2rem; cursor:pointer;"><i class="ri-close-line"></i></button>';
            header.style.cssText = 'padding:15px; background:linear-gradient(135deg, #f3e8ff, #e0e7ff); color:#6d28d9; font-size:0.95rem; font-weight:700; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;';
            header.querySelector('.close-ai-btn').onclick = () => overlay.remove();
            popup.appendChild(header);

            data.suggestions.forEach((suggestionText) => {
                const optBtn = document.createElement('button');
                optBtn.type = 'button';
                optBtn.innerText = suggestionText;
                optBtn.style.cssText = 'width:100%; padding:15px; text-align:left; background:transparent; border:none; border-bottom:1px solid #f8fafc; cursor:pointer; font-size:0.95rem; color:#334155; transition:background 0.2s; line-height:1.5; font-family:inherit;';
                optBtn.onmouseover = () => optBtn.style.background = '#f8fafc';
                optBtn.onmouseout = () => optBtn.style.background = 'transparent';
                optBtn.onclick = (event) => {
                    event.preventDefault();
                    inputElement.value = suggestionText;
                    overlay.remove();
                    btnElement.innerHTML = '<i class="ri-check-line" style="color:#10b981; font-weight:bold;"></i>';
                    setTimeout(() => btnElement.innerHTML = originalIcon, 1500);
                };
                popup.appendChild(optBtn);
            });
            overlay.appendChild(popup);
            document.body.appendChild(overlay);
        }
    } catch (e) {
        btnElement.innerHTML = originalIcon;
        btnElement.disabled = false;
    }
};

window.loadDailyPlanDashboard = async function() {
    const container = document.getElementById('aiDailyPlanContainer');
    if (!container) return;

    container.innerHTML = `
        <div style="background: linear-gradient(135deg, #f3e8ff, #e0e7ff); border: 1px solid #c4b5fd; padding: 15px 20px; border-radius: 12px; margin-bottom: 20px; display: flex; align-items: center; gap: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="font-size: 2rem; color: #8b5cf6;"><i class="ri-robot-2-fill"></i></div>
            <div style="flex: 1;">
                <h4 style="margin: 0 0 5px 0; color: #4c1d95; font-size: 1rem; display: flex; align-items: center; gap: 5px;">AI Daily Reminder <i class="ri-sparkling-fill" style="font-size: 0.9rem; color: #8b5cf6;"></i></h4>
                <p id="aiPlanText" style="margin: 0; color: #5b21b6; font-size: 0.9rem; line-height: 1.4;">Thinking...</p>
            </div>
        </div>
    `;

    try {
        const res = await fetch('/api/ai/daily-plan');
        const data = await res.json();
        if (data.success) { 
            document.getElementById('aiPlanText').innerText = data.plan; 
        } else { 
            container.style.display = 'none'; 
        }
    } catch (e) { 
        container.style.display = 'none'; 
    }
};

const observer = new MutationObserver(() => {
    const container = document.getElementById('aiDailyPlanContainer');
    if (container && !container.dataset.aiLoaded) {
        container.dataset.aiLoaded = 'true';
        window.loadDailyPlanDashboard();
    }
});

observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('aiDailyPlanContainer');
    if (container) { 
        container.dataset.aiLoaded = 'true'; 
        window.loadDailyPlanDashboard(); 
    }
});