// public/calls.js
// =====================================================================
// SMART CALL LOG TRACKER (Ultra Premium Centered Selection Dialog)
// =====================================================================

window.callReasons = {
    'pdd': [
        'Ring but not received', 
        'Switched off', 
        'Not reachable', 
        '3rd party attended', 
        'Will pay today', 
        'Pay tomorrow', 
        'Pay later', 
        "Don't want to pay", 
        'Escalate', 
        'Call Cancelled / Error'
    ],
    'verification': [
        'Ring but not received', 
        'Switched off', 
        'Not reachable', 
        'Call back', 
        '3rd person received', 
        'Verification not done', 
        'Will visit store', 
        'Call Cancelled / Error'
    ],
    'normal': [
        'Ring but not received', 
        'Switched off', 
        'Not reachable', 
        'Call back', 
        '3rd person received', 
        'Call Cancelled / Error'
    ]
};

window.ensureCallModalExists = function() {
    if (document.getElementById('callLogModal')) return;
    
    // HTML with Ultra Premium Centered Dialog Dropdown
    const modalHtml = `
    <style>
        .stylish-select { position: relative; width: 100%; user-select: none; }
        .stylish-select-trigger {
            display: flex; align-items: center; justify-content: space-between;
            width: 100%; padding: 15px 16px 15px 40px; 
            border: 1px solid var(--border); border-radius: 12px;
            background: var(--bg-card); color: var(--text-main);
            cursor: pointer; font-size: 0.95rem; font-weight: 500;
            transition: all 0.2s ease;
            box-shadow: 0 2px 5px rgba(0,0,0,0.02);
        }
        .stylish-select-trigger:active { transform: scale(0.98); }
        .stylish-select-trigger i.ri-arrow-down-s-line { font-size: 1.2rem; color: var(--text-muted); }
        
        /* 🔥 NEW: Modern Centered Dialog (Screen ke BEECHME) */
        .stylish-backdrop {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(5px);
            -webkit-backdrop-filter: blur(5px);
            z-index: 13000; opacity: 0; pointer-events: none;
            transition: opacity 0.3s ease;
        }
        .stylish-backdrop.open { opacity: 1; pointer-events: all; }
        
        .stylish-options-dialog {
            position: fixed; top: 50%; left: 50%;
            transform: translate(-50%, -45%) scale(0.95);
            width: 90%; max-width: 380px; max-height: 65vh; /* Scrollable if large */
            background: var(--bg-card); border: 1px solid var(--border);
            border-radius: 20px; overflow-y: auto;
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.4);
            z-index: 13001; opacity: 0; pointer-events: none;
            transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
            padding: 15px 10px 10px 10px; display: flex; flex-direction: column; gap: 4px;
        }
        .stylish-options-dialog.open {
            opacity: 1; pointer-events: all;
            transform: translate(-50%, -50%) scale(1);
        }
        
        .stylish-options-title {
            text-align: center; font-size: 0.8rem; font-weight: 700; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;
        }
        
        .stylish-option {
            padding: 14px 16px; border-radius: 12px; cursor: pointer;
            color: var(--text-main); font-size: 1rem; font-weight: 500;
            transition: background 0.2s, transform 0.1s;
            display: flex; align-items: center; gap: 10px;
        }
        .stylish-option i { color: var(--primary); font-size: 1.1rem; opacity: 0.7; }
        .stylish-option:active { transform: scale(0.98); background: rgba(79, 70, 229, 0.15); }
        
        /* Highlighted Custom Option */
        .custom-opt { 
            color: var(--primary); font-weight: 700; 
            background: rgba(79, 70, 229, 0.05); 
            border: 1px dashed rgba(79, 70, 229, 0.3); 
            margin-top: 5px; 
        }
        .custom-opt i { opacity: 1; }
    </style>
    
    <div class="stylish-backdrop" id="customSelectBackdrop" onclick="closeStylishSelect()"></div>
    <div class="stylish-options-dialog" id="customOptionsList">
        <div class="stylish-options-title">Select Call Outcome</div>
        </div>

    <div id="callLogModal" class="modal-overlay" style="display: none; z-index: 12000;">
        <div class="modal-card">
            <div class="modal-header">
                <h3><i class="ri-phone-line" style="color: var(--primary);"></i> Log Call Outcome</h3>
                <button type="button" onclick="closeCallLogModal()" class="icon-btn"><i class="ri-close-line"></i></button>
            </div>
            
            <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 15px;">Please record the outcome of the call.</p>
            
            <form id="callLogForm" onsubmit="submitCallLog(event)">
                <input type="hidden" id="callLogCustomerId">
                <input type="hidden" id="callLogPageType">
                
                <div class="input-group">
                    <label>Call Reason / Outcome <span style="color:red">*</span></label>
                    
                    <div class="input-wrapper stylish-select">
                        <i class="ri-question-answer-line icon-left" style="z-index: 10;"></i>
                        <div class="stylish-select-trigger" id="customSelectTrigger" onclick="toggleStylishSelect()">
                            <span id="customSelectText">Select an outcome...</span>
                            <i class="ri-arrow-down-s-line"></i>
                        </div>
                        <input type="hidden" id="callLogReason" name="reason">
                    </div>
                </div>

                <div class="input-group" id="callLogCustomField" style="display: none; margin-top: 15px;">
                    <label>Type Custom Remark <span style="color:red">*</span></label>
                    <textarea id="callLogCustomInput" rows="3" placeholder="Type exactly what happened..." style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 12px; font-family: 'Inter'; outline: none; resize: vertical; background: var(--bg-card); color: var(--text-main); transition: all 0.3s ease;"></textarea>
                </div>

                <div class="input-group" id="callLogNotesDiv" style="margin-top: 15px; transition: opacity 0.3s ease;">
                    <label>Optional Notes</label>
                    <div class="input-wrapper">
                        <i class="ri-sticky-note-line icon-left"></i>
                        <input type="text" id="callLogNotes" placeholder="Any additional details..." style="background: var(--bg-card); color: var(--text-main);">
                    </div>
                </div>
                
                <button type="submit" class="btn-submit" style="margin-top:20px;">Save Call Log</button>
            </form>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

// --- Centered Dialog Dropdown Logic ---
window.toggleStylishSelect = function() {
    document.getElementById('customOptionsList').classList.add('open');
    document.getElementById('customSelectBackdrop').classList.add('open');
};

window.closeStylishSelect = function() {
    document.getElementById('customOptionsList').classList.remove('open');
    document.getElementById('customSelectBackdrop').classList.remove('open');
};

window.selectStylishOption = function(value, text) {
    document.getElementById('callLogReason').value = value;
    document.getElementById('customSelectText').innerText = text;
    window.closeStylishSelect();
    handleCallReasonChange(value);
};

// Toggle function: Shows Textarea & Disables Optional Notes
window.handleCallReasonChange = function(selectedValue) {
    const customField = document.getElementById('callLogCustomField');
    const customInput = document.getElementById('callLogCustomInput');
    const notesDiv = document.getElementById('callLogNotesDiv');
    const notesInput = document.getElementById('callLogNotes');
    
    if (selectedValue === 'CUSTOM') {
        customField.style.display = 'block';
        customInput.setAttribute('required', 'true');
        customInput.focus();
        
        notesInput.disabled = true;
        notesInput.value = ''; 
        notesDiv.style.opacity = '0.4';
        notesDiv.style.pointerEvents = 'none';
    } else {
        customField.style.display = 'none';
        customInput.removeAttribute('required');
        customInput.value = ''; 
        
        notesInput.disabled = false;
        notesDiv.style.opacity = '1';
        notesDiv.style.pointerEvents = 'auto';
    }
};

window.closeCallLogModal = function() {
    const m = document.getElementById('callLogModal');
    if (m) {
        m.classList.remove('active');
        setTimeout(() => m.style.display = 'none', 300);
    }
    sessionStorage.removeItem('pendingCallLog');
    sessionStorage.removeItem('callStartedTime');
    
    // Safety close for dropdown
    window.closeStylishSelect();
};

window.handleCallClick = function(e, element) {
    const id = element.getAttribute('data-id');
    let page = element.getAttribute('data-page') || 'normal';
    sessionStorage.setItem('pendingCallLog', JSON.stringify({ id, page }));
    sessionStorage.setItem('callStartedTime', Date.now());
};

window.checkPendingCallLog = function() {
    const pending = sessionStorage.getItem('pendingCallLog');
    const startTime = sessionStorage.getItem('callStartedTime');
    if (pending && startTime) {
        if (Date.now() - parseInt(startTime) > 1000) { 
            window.showCallLogModal(JSON.parse(pending));
        }
    }
};

window.addEventListener('focus', () => setTimeout(window.checkPendingCallLog, 500));

window.showCallLogModal = function(data) {
    sessionStorage.removeItem('pendingCallLog');
    sessionStorage.removeItem('callStartedTime');
    
    window.ensureCallModalExists();
    document.getElementById('callLogCustomerId').value = data.id;
    document.getElementById('callLogPageType').value = data.page;
    
    const optionsList = document.getElementById('customOptionsList');
    const reasons = window.callReasons[data.page] || window.callReasons['normal'];
    
    // Filter out old texts
    const filteredReasons = reasons.filter(r => r !== 'Additional Remark' && r !== 'CUSTOM');
    
    // Build the stylish centered dialog HTML
    let listHTML = '<div class="stylish-options-title">Select Call Outcome</div>';
    filteredReasons.forEach(r => {
        const safeText = r.replace(/'/g, "\\'");
        listHTML += `<div class="stylish-option" onclick="selectStylishOption('${safeText}', '${safeText}')"><i class="ri-record-circle-line"></i> ${r}</div>`;
    });
    // Add custom remark button at bottom
    listHTML += `<div class="stylish-option custom-opt" onclick="selectStylishOption('CUSTOM', '📝 Custom / Additional Remark...')"><i class="ri-edit-box-line"></i> 📝 Custom / Additional Remark...</div>`;
    
    optionsList.innerHTML = listHTML;
        
    // Reset fields on modal open
    document.getElementById('callLogReason').value = '';
    document.getElementById('customSelectText').innerText = 'Select an outcome...';
    
    const notesInput = document.getElementById('callLogNotes');
    const notesDiv = document.getElementById('callLogNotesDiv');
    
    notesInput.value = '';
    notesInput.disabled = false;
    notesDiv.style.opacity = '1';
    notesDiv.style.pointerEvents = 'auto';
    
    document.getElementById('callLogCustomInput').value = '';
    document.getElementById('callLogCustomField').style.display = 'none';
    
    const m = document.getElementById('callLogModal');
    m.style.display = 'flex';
    setTimeout(() => m.classList.add('active'), 10);
};

window.submitCallLog = async function(e) {
    e.preventDefault();
    const id = document.getElementById('callLogCustomerId').value;
    const pageType = document.getElementById('callLogPageType').value;
    let reason = document.getElementById('callLogReason').value;
    let notes = document.getElementById('callLogNotes').value;
    
    if (!reason) {
        alert("Please select a call reason/outcome.");
        return;
    }
    
    if (reason === 'CUSTOM') {
        reason = document.getElementById('callLogCustomInput').value.trim();
        notes = ''; 
        
        if (!reason) {
            alert("Please type your custom remark.");
            document.getElementById('callLogCustomInput').focus();
            return;
        }
    }
    
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="ri-loader-4-line spin-loader"></i> Saving...';
    btn.disabled = true;

    try {
        await fetch(`/log-call/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageType, reason, notes })
        });
        window.closeCallLogModal();
        if(typeof window.navigateTo === 'function') window.navigateTo(window.location.pathname + window.location.search, false);
    } catch(err) {
        console.error("Failed to save log:", err);
        alert("Error saving call remark.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};