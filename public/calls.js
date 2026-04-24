// public/calls.js
// =====================================================================
// SMART CALL LOG TRACKER
// =====================================================================

window.callReasons = {
    'pdd': ['Ring but not received', 'Switched off', 'Not reachable', '3rd party attended', 'Will pay today', 'Pay tomorrow', 'Pay later', "Don't want to pay", 'Escalate', 'Call Cancelled / Error'],
    'verification': ['Ring but not received', 'Switched off', 'Not reachable', 'Call back', '3rd person received', 'Verification not done', 'Will visit store', 'Call Cancelled / Error'],
    'normal': ['Ring but not received', 'Switched off', 'Not reachable', 'Call back', '3rd person received', 'Call Cancelled / Error']
};

window.ensureCallModalExists = function() {
    if (document.getElementById('callLogModal')) return;
    const modalHtml = `
    <div id="callLogModal" class="modal-overlay" style="display: none; z-index: 12000;">
        <div class="modal-card">
            <div class="modal-header">
                <h3><i class="ri-phone-line" style="color: var(--primary);"></i> Log Call Outcome</h3>
                <button type="button" onclick="closeCallLogModal()" class="icon-btn"><i class="ri-close-line"></i></button>
            </div>
            <p style="font-size: 0.85rem; color: #64748b; margin-bottom: 15px;">Please record the outcome of the call to continue.</p>
            <form id="callLogForm" onsubmit="submitCallLog(event)">
                <input type="hidden" id="callLogCustomerId">
                <input type="hidden" id="callLogPageType">
                <div class="input-group">
                    <label>Call Reason / Outcome <span style="color:red">*</span></label>
                    <div class="input-wrapper">
                        <i class="ri-question-answer-line icon-left"></i>
                        <select id="callLogReason" required>
                            <option value="" disabled selected>Select an outcome...</option>
                        </select>
                    </div>
                </div>
                <div class="input-group" style="margin-top: 15px;">
                    <label>Optional Notes</label>
                    <div class="input-wrapper">
                        <i class="ri-sticky-note-line icon-left"></i>
                        <input type="text" id="callLogNotes" placeholder="Any additional details...">
                    </div>
                </div>
                <button type="submit" class="btn-submit" style="margin-top:20px;">Save Call Log</button>
            </form>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.closeCallLogModal = function() {
    const m = document.getElementById('callLogModal');
    if (m) {
        m.classList.remove('active');
        setTimeout(() => m.style.display = 'none', 300);
    }
    sessionStorage.removeItem('pendingCallLog');
    sessionStorage.removeItem('callStartedTime');
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
    const reasonSelect = document.getElementById('callLogReason');
    const reasons = window.callReasons[data.page] || window.callReasons['normal'];
    reasonSelect.innerHTML = '<option value="" disabled selected>Select an outcome...</option>' + 
        reasons.map(r => `<option value="${r}">${r}</option>`).join('');
    document.getElementById('callLogNotes').value = '';
    
    const m = document.getElementById('callLogModal');
    m.style.display = 'flex';
    setTimeout(() => m.classList.add('active'), 10);
};

window.submitCallLog = async function(e) {
    e.preventDefault();
    const id = document.getElementById('callLogCustomerId').value;
    const pageType = document.getElementById('callLogPageType').value;
    const reason = document.getElementById('callLogReason').value;
    const notes = document.getElementById('callLogNotes').value;
    
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
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};