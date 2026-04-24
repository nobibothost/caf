// public/app.js
// =====================================================================
// SMART SPA CORE, GLOBAL MODAL ENGINE & DYNAMIC UI LOGIC
// =====================================================================

window.appCache = window.appCache || {};
window.fpAdd = null; 
window.fpEdit = null; 
window.formToSubmit = null;
const fpConfig = { dateFormat: "Y-m-d", altInput: true, altFormat: "d/m/Y", allowInput: true, disableMobile: true };

// --- FAMILY TREE MODAL LOGIC (GLOBAL SCOPE FOR SPA FIX) ---
window.openFamilyModal = function(id) {
    const dataDiv = document.getElementById('tree_data_' + id);
    const modalBody = document.getElementById('familyTreeBody');
    const modal = document.getElementById('familyTreeModal');

    if (dataDiv && modalBody && modal) {
        modalBody.innerHTML = dataDiv.innerHTML;
        modal.style.display = 'flex';
        // Small delay to trigger CSS transition
        setTimeout(() => modal.classList.add('active'), 10);
        document.body.style.overflow = 'hidden'; 
    } else {
        console.error("Family Tree data container or Modal not found in DOM!");
    }
};

window.closeFamilyModal = function() {
    const modal = document.getElementById('familyTreeModal');
    const modalBody = document.getElementById('familyTreeBody');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.style.display = 'none';
            if (modalBody) modalBody.innerHTML = '';
        }, 300);
    }
    document.body.style.overflow = 'auto'; 
};

// --- CALLING LOGIC (SMART CALL TRACKER) ---
const callReasons = {
    'pdd': [
        'Ring but not received', 'Switched off', 'Not reachable', '3rd party attended', 
        'Will pay today', 'Pay tomorrow', 'Pay later', "Don't want to pay", 'Escalate', 'Call Cancelled / Error'
    ],
    'verification': [
        'Ring but not received', 'Switched off', 'Not reachable', 'Call back', 
        '3rd person received', 'Verification not done', 'Will visit store', 'Call Cancelled / Error'
    ],
    'normal': [
        'Ring but not received', 'Switched off', 'Not reachable', 'Call back', 
        '3rd person received', 'Call Cancelled / Error'
    ]
};

function ensureCallModalExists() {
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
}

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

function checkPendingCallLog() {
    const pending = sessionStorage.getItem('pendingCallLog');
    const startTime = sessionStorage.getItem('callStartedTime');
    if (pending && startTime) {
        if (Date.now() - parseInt(startTime) > 1000) { 
            showCallLogModal(JSON.parse(pending));
        }
    }
}

window.addEventListener('focus', () => setTimeout(checkPendingCallLog, 500));

function showCallLogModal(data) {
    sessionStorage.removeItem('pendingCallLog');
    sessionStorage.removeItem('callStartedTime');
    
    ensureCallModalExists();
    document.getElementById('callLogCustomerId').value = data.id;
    document.getElementById('callLogPageType').value = data.page;
    const reasonSelect = document.getElementById('callLogReason');
    const reasons = callReasons[data.page] || callReasons['normal'];
    reasonSelect.innerHTML = '<option value="" disabled selected>Select an outcome...</option>' + 
        reasons.map(r => `<option value="${r}">${r}</option>`).join('');
    document.getElementById('callLogNotes').value = '';
    
    const m = document.getElementById('callLogModal');
    m.style.display = 'flex';
    setTimeout(() => m.classList.add('active'), 10);
}

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
        navigateTo(window.location.pathname + window.location.search, false);
    } catch(err) {
        console.error("Failed to save log:", err);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// --- CHART RENDERING (SYNCED PREMIUM COLORS) ---
function renderChart(chartCanvas) {
    if (window.myPieChart) window.myPieChart.destroy(); 
    const dataValues = [
        parseInt(chartCanvas.getAttribute('data-nc')) || 0,
        parseInt(chartCanvas.getAttribute('data-p2p')) || 0,
        parseInt(chartCanvas.getAttribute('data-mnp')) || 0, 
        parseInt(chartCanvas.getAttribute('data-nmnp')) || 0,
        parseInt(chartCanvas.getAttribute('data-pdr')) || 0,
        parseInt(chartCanvas.getAttribute('data-family')) || 0
    ];
    
    if (dataValues.reduce((a, b) => a + b, 0) > 0) {
        const ctx = chartCanvas.getContext('2d');
        window.myPieChart = new Chart(ctx, {
            type: 'doughnut',
            data: { 
                labels: ['NC', 'P2P', 'MNP', 'NMNP', 'PDR', 'Family'], 
                datasets: [{ 
                    data: dataValues, 
                    // Matches Pantone Colors: Scuba Blue, Tangerine, Classic Blue, Marsala, Strawberry Ice, Lucite Green
                    backgroundColor: ['#00ABC0', '#F28C48', '#0F4C81', '#964F4C', '#E88C96', '#54B2A1'], 
                    borderWidth: 0, 
                    hoverOffset: 4 
                }] 
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                cutout: '70%', 
                plugins: { 
                    legend: { 
                        position: 'right',
                        labels: { boxWidth: 12, padding: 15, font: { family: "'Inter', sans-serif", size: 12, weight: 500 } }
                    } 
                } 
            }
        });
    } else { 
        chartCanvas.parentElement.innerHTML = '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:0.95rem; font-weight:500;">No Data For Selected Month</div>';
    }
}

// --- APP INITIALIZATION ---
function initApp() {
    // Basic Date Pickers
    const addEl = document.getElementById("customDate"); 
    if(addEl) window.fpAdd = flatpickr(addEl, fpConfig);
    
    const editEl = document.getElementById("editDate"); 
    if(editEl) window.fpEdit = flatpickr(editEl, fpConfig);

    // Initialize Custom Range Picker
    const rangePickers = document.querySelectorAll('.custom-range-picker');
    if (rangePickers.length > 0) {
        flatpickr(rangePickers, {
            mode: "range",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "d/m/Y",
            allowInput: false,
            onClose: function(selectedDates, dateStr, instance) {
                if (selectedDates.length === 2) {
                    const startStr = instance.formatDate(selectedDates[0], "Y-m-d");
                    const endStr = instance.formatDate(selectedDates[1], "Y-m-d");
                    const form = instance.input.closest('form');
                    const url = new URL(form.action || window.location.href, window.location.origin);
                    url.searchParams.delete('month'); // remove standard month
                    url.searchParams.set('start', startStr);
                    url.searchParams.set('end', endStr);
                    navigateTo(url.pathname + url.search);
                }
            }
        });
    }
    
    // Initialize Chart
    const chartCanvas = document.getElementById('categoryChart');
    if (chartCanvas) {
        if (window.Chart) renderChart(chartCanvas);
        else {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js'; 
            script.onload = () => renderChart(chartCanvas); 
            document.head.appendChild(script); 
        }
    }
    
    // Quick search logic for current view
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.removeEventListener('keyup', window.filterList);
        searchInput.addEventListener('keyup', window.filterList);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    const scrollPath = sessionStorage.getItem('scrollPath'); 
    const currentPath = window.location.pathname + window.location.search;
    if (scrollPath === currentPath) { 
        const scrollPos = sessionStorage.getItem('scrollPos'); 
        if (scrollPos) setTimeout(() => window.scrollTo(0, parseInt(scrollPos)), 50); 
    }
    sessionStorage.removeItem('scrollPos'); 
    sessionStorage.removeItem('scrollPath');
});

// --- SPA NAVIGATION CORE ---
async function navigateTo(url, push = true) {
    const mainApp = document.getElementById('app-main'); 
    const cacheKey = url;

    // Show skeleton/loading state
    if (mainApp) mainApp.style.opacity = '0.6';

    try {
        const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const html = await res.text(); 
        const parser = new DOMParser(); 
        const doc = parser.parseFromString(html, 'text/html'); 
        const newMain = doc.getElementById('app-main');

        if (newMain && mainApp) { 
            mainApp.innerHTML = newMain.innerHTML; 
            mainApp.style.opacity = '1';
            if (push) history.pushState({}, '', url); 
            
            // Sync bottom navigation active state
            document.querySelectorAll('.bottom-nav .nav-item').forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === url.split('?')[0]) link.classList.add('active');
            });

            initApp();
            window.scrollTo(0,0);
        } else { 
            window.location.href = url;
        }
    } catch (err) { 
        window.location.href = url; 
    }
}

window.addEventListener('popstate', () => navigateTo(window.location.pathname + window.location.search, false));

// --- GLOBAL CLICK DISPATCHER ---
document.addEventListener('click', e => {
    // 1. SPA Bottom Nav Logic
    const navItem = e.target.closest('.bottom-nav .nav-item');
    if (navItem && navItem.getAttribute('href') && navItem.getAttribute('href') !== '#') {
        e.preventDefault();
        navigateTo(navItem.getAttribute('href'));
        return;
    }

    // 2. Family Tree Global Catch (Fixes SPA Bug)
    const treeBtn = e.target.closest('.btn-view-tree');
    if (treeBtn) {
        e.preventDefault();
        window.openFamilyModal(treeBtn.getAttribute('data-tree-id'));
        return;
    }

    // 3. Modal Overlay Click-Outside Logic
    if (e.target.classList.contains('modal-overlay')) {
        if (e.target.id === 'familyTreeModal') {
            window.closeFamilyModal();
        } else if (e.target.id === 'callLogModal') {
            window.closeCallLogModal();
        } else {
            e.target.classList.remove('active');
            setTimeout(() => e.target.style.display = 'none', 300);
        }
        return;
    }

    // 4. Custom Confirm Modal Logic
    if (e.target.id === 'confirmYesBtn') {
        const btn = e.target; 
        btn.innerHTML = '<i class="ri-loader-4-line btn-spinner"></i> Processing...'; 
        btn.style.opacity = '0.7'; 
        btn.style.pointerEvents = 'none';
        if (window.formToSubmit) {
            if (typeof window.formToSubmit === 'string') { 
                window.location.href = window.formToSubmit; 
            } else {
                let returnInput = window.formToSubmit.querySelector('input[name="returnUrl"]');
                if (!returnInput) { 
                    returnInput = document.createElement('input'); 
                    returnInput.type = 'hidden'; 
                    returnInput.name = 'returnUrl'; 
                    window.formToSubmit.appendChild(returnInput); 
                }
                returnInput.value = window.location.pathname + window.location.search; 
                sessionStorage.setItem('scrollPos', window.scrollY); 
                sessionStorage.setItem('scrollPath', window.location.pathname + window.location.search); 
                delete window.appCache[window.location.pathname + window.location.search]; 
                window.formToSubmit.submit();
            }
        }
    }
});

// Loading spinners for regular forms
document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.id === 'addForm' || form.id === 'editForm') {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) { 
            if (submitBtn.dataset.loading === 'true') { e.preventDefault(); return; } 
            submitBtn.dataset.loading = 'true'; 
            submitBtn.innerHTML = `<i class="ri-loader-4-line btn-spinner"></i> ${form.id === 'addForm' ? 'Saving...' : 'Updating...'}`; 
            submitBtn.style.opacity = '0.7'; 
            submitBtn.style.cursor = 'not-allowed'; 
        }
    }
    if(form.getAttribute('action') !== '/search' && !form.getAttribute('onsubmit') && form.id !== 'loginForm' && form.id !== 'callLogForm') {
        let returnInput = form.querySelector('input[name="returnUrl"]'); 
        if (!returnInput) { 
            returnInput = document.createElement('input'); 
            returnInput.type = 'hidden'; 
            returnInput.name = 'returnUrl';
            form.appendChild(returnInput); 
        }
        returnInput.value = window.location.pathname + window.location.search; 
        sessionStorage.setItem('scrollPos', window.scrollY); 
        sessionStorage.setItem('scrollPath', window.location.pathname + window.location.search);
        delete window.appCache[window.location.pathname + window.location.search];
    }
});

// --- FILTER & SEARCH HELPERS ---
window.handleFilterChange = function(e, selectEl) { 
    const form = selectEl.closest('form'); 
    const url = new URL(form.action || window.location.href, window.location.origin); 
    url.searchParams.set(selectEl.name, selectEl.value); 
    
    // Clear custom range variables if normal month is selected
    if (selectEl.value !== 'custom') {
        url.searchParams.delete('start');
        url.searchParams.delete('end');
    }
    
    navigateTo(url.pathname + url.search);
};

window.filterList = function() { 
    const input = document.getElementById('searchInput'); 
    if(!input) return; 
    const filter = input.value.toLowerCase();
    const items = document.getElementsByClassName('search-item'); 
    for (let i = 0; i < items.length; i++) { 
        if (items[i].innerText.toLowerCase().includes(filter)) items[i].style.display = "";
        else items[i].style.display = "none"; 
    } 
};

async function performLiveSearch(query) {
    const targetUrl = query ? `/search?q=${encodeURIComponent(query)}` : '/search';
    window.history.replaceState(null, '', targetUrl); 
    try { 
        const response = await fetch(targetUrl);
        const html = await response.text(); 
        const parser = new DOMParser(); 
        const doc = parser.parseFromString(html, 'text/html'); 
        const newResults = doc.getElementById('searchResultsArea');
        const currentResults = document.getElementById('searchResultsArea'); 
        if (newResults && currentResults) { 
            currentResults.innerHTML = newResults.innerHTML;
        } 
    } catch (err) { console.error('Live search error', err); } 
    finally { 
        const sIcon = document.getElementById('searchIcon');
        const lIcon = document.getElementById('loadingIcon'); 
        if(sIcon) sIcon.style.display = 'block'; 
        if(lIcon) lIcon.style.display = 'none';
    }
}

// --- DYNAMIC FORM LOGIC ---
window.handleCategoryChange = function(isEdit = false) { 
    const prefix = isEdit ? 'edit' : '';
    const cat = document.getElementById(prefix + (isEdit ? 'Category' : 'category'))?.value;
    const nForm = document.getElementById(prefix + (isEdit ? '-normal-form' : 'normal-form')); 
    const fForm = document.getElementById(prefix + (isEdit ? '-family-form' : 'family-form'));
    const planSelect = document.getElementById(prefix + (isEdit ? 'Plan' : 'plan'));

    if(!nForm || !fForm) return; 
    nForm.classList.remove('active'); 
    fForm.classList.remove('active');
    
    if(planSelect) {
        if (cat === 'Family') { 
            planSelect.innerHTML = '<option value="701">701</option><option value="1201">1201</option><option value="1401">1401</option><option value="1601 RedEx">1601 RedEx</option>';
            if(!isEdit) planSelect.value = '701'; 
        } else { 
            planSelect.innerHTML = '<option value="451">451</option><option value="551">551</option><option value="751">751</option><option value="1201 RedEx">1201 RedEx</option>';
            if(!isEdit) planSelect.value = '451'; 
        }
    }
    
    if (cat === 'Family') { 
        fForm.classList.add('active');
        if(document.getElementById(prefix + (isEdit ? 'NName' : 'n_name'))) document.getElementById(prefix + (isEdit ? 'NName' : 'n_name')).required = false;
        if(document.getElementById(prefix + (isEdit ? 'NMobile' : 'n_mobile'))) document.getElementById(prefix + (isEdit ? 'NMobile' : 'n_mobile')).required = false;
    } else { 
        nForm.classList.add('active');
        if(document.getElementById(prefix + (isEdit ? 'NName' : 'n_name'))) document.getElementById(prefix + (isEdit ? 'NName' : 'n_name')).required = true;
        if(document.getElementById(prefix + (isEdit ? 'NMobile' : 'n_mobile'))) document.getElementById(prefix + (isEdit ? 'NMobile' : 'n_mobile')).required = true;
    } 
};

window.addSecondaryRow = function(isEdit = false, data = {}) {
    const container = document.getElementById('secondaries-container-' + (isEdit ? 'edit' : 'add'));
    if(!container) return;
    const rowId = Date.now() + Math.random().toString(36).substr(2, 5);
    const html = `
    <div class="secondary-row" id="sec-row-${rowId}" style="position: relative; margin-top: 15px; padding-top: 15px; border-top: 1px dashed var(--border);">
        ${data._id ? `<input type="hidden" name="s_id" value="${data._id}">` : `<input type="hidden" name="s_id" value="">`}
        <span class="section-label" style="display:inline-block; margin-top:0;">Additional Secondary</span>
        <button type="button" onclick="this.closest('.secondary-row').remove()" style="position: absolute; right: 0; top: 12px; background: #fee2e2; color: #ef4444; border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer;"><i class="ri-delete-bin-line"></i></button>
        <div class="input-group">
            <div class="input-wrapper">
                <i class="ri-sim-card-line icon-left"></i>
                <select name="s_type" required>
                    <option value="Existing" ${data.subType==='Existing'?'selected':''}>Existing (Active)</option>
                    <option value="NC" ${data.subType==='NC'?'selected':''}>NC</option>
                    <option value="P2P" ${data.subType==='P2P'?'selected':''}>P2P</option>
                    <option value="MNP" ${data.subType==='MNP'?'selected':''}>MNP</option>
                    <option value="NMNP" ${data.subType==='NMNP'?'selected':''}>NMNP</option>
                    <option value="PDR" ${data.subType==='PDR'?'selected':''}>PDR</option>
                </select>
            </div>
        </div>
        <div class="input-group">
            <div class="input-wrapper">
                <i class="ri-user-smile-line icon-left"></i>
                <input type="text" name="s_name" value="${data.name || ''}" placeholder="e.g., Rahul Kumar (Secondary)" required>
            </div>
        </div>
        <div class="input-group">
            <div class="input-wrapper">
                <i class="ri-smartphone-line icon-left"></i>
                <input type="tel" name="s_mobile" value="${data.mobile || ''}" placeholder="e.g., 9876543210" pattern="[0-9]{10}" required>
            </div>
        </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
};

// --- FORM MODALS ---
window.openModal = function() { 
    const m = document.getElementById("addModal");
    if(!m) return; 
    m.style.display = 'flex'; 
    setTimeout(() => m.classList.add('active'), 10); 
    if(window.fpAdd) window.fpAdd.setDate(new Date()); 
    
    const container = document.getElementById('secondaries-container-add');
    if(container) container.innerHTML = '';
    const sTypeAdd = document.getElementById('s_type');
    const sNameAdd = document.getElementById('s_name');
    const sMobileAdd = document.getElementById('s_mobile');
    if(sTypeAdd) sTypeAdd.value = 'NC';
    if(sNameAdd) sNameAdd.value = '';
    if(sMobileAdd) sMobileAdd.value = '';

    window.handleCategoryChange(false); 
};

window.closeModal = function() { 
    const m = document.getElementById("addModal"); 
    if(!m) return; 
    m.classList.remove('active');
    setTimeout(() => m.style.display = 'none', 300); 
};

window.openEditModal = function(btn) { 
    const form = document.getElementById('editForm'); 
    const delForm = document.getElementById('deleteForm');
    if(!form || !delForm) return;
    
    const id = btn.getAttribute('data-id');
    form.action = "/edit/" + id; 
    delForm.action = "/delete/" + id;
    const cat = btn.getAttribute('data-category'); 
    document.getElementById('editCategory').value = cat;
    window.handleCategoryChange(true);
    
    const savedPlan = btn.getAttribute('data-plan') || (cat === 'Family' ? '701' : '451');
    if(document.getElementById('editPlan')) document.getElementById('editPlan').value = savedPlan;
    
    if(window.fpEdit) window.fpEdit.setDate(btn.getAttribute('data-date'));
    document.getElementById('editRemarks').value = btn.getAttribute('data-remarks') || ''; 
    document.getElementById('editBillDate').value = btn.getAttribute('data-billdate') || '';
    
    if (cat === 'Family') { 
        document.getElementById('editOldPMobile').value = btn.getAttribute('data-p-mobile');
        document.getElementById('editPType').value = btn.getAttribute('data-p-status');
        document.getElementById('editPName').value = btn.getAttribute('data-p-name'); 
        document.getElementById('editPMobile').value = btn.getAttribute('data-p-mobile'); 
        
        const secContainer = document.getElementById('secondaries-container-edit');
        if(secContainer) secContainer.innerHTML = '';
        
        const secDataStr = btn.getAttribute('data-secondaries');
        if(secDataStr) {
            const secondaries = JSON.parse(decodeURIComponent(secDataStr));
            if(secondaries.length > 0) {
                document.getElementById('editSType').value = secondaries[0].subType || 'NC';
                document.getElementById('editSName').value = secondaries[0].name || '';
                document.getElementById('editSMobile').value = secondaries[0].mobile || '';
                document.getElementById('editSId').value = secondaries[0]._id || '';
                for(let i = 1; i < secondaries.length; i++) {
                    window.addSecondaryRow(true, secondaries[i]);
                }
            }
        } else {
            document.getElementById('editSType').value = 'NC';
            document.getElementById('editSName').value = '';
            document.getElementById('editSMobile').value = '';
            document.getElementById('editSId').value = '';
        }
    } else { 
        document.getElementById('editNName').value = btn.getAttribute('data-name');
        document.getElementById('editNMobile').value = btn.getAttribute('data-mobile'); 
        document.getElementById('editSType').value = cat; 
    } 
    
    const m = document.getElementById("editModal");
    m.style.display = 'flex'; 
    setTimeout(() => m.classList.add('active'), 10); 
};

window.closeEditModal = function() { 
    const m = document.getElementById("editModal");
    if(m) { 
        m.classList.remove('active'); 
        setTimeout(() => m.style.display = 'none', 300);
    } 
};

window.openConfirmModal = function(event, element, actionType) {
    if(event) event.preventDefault(); 
    window.formToSubmit = element || '/logout';
    const titleEl = document.getElementById('confirmTitle'); 
    const msgEl = document.getElementById('confirmMessage'); 
    const iconEl = document.getElementById('confirmIcon'); 
    const yesBtn = document.getElementById('confirmYesBtn'); 
    const m = document.getElementById('customConfirmModal');
    if(!m) return; 
    
    yesBtn.className = 'btn-confirm-yes'; 
    yesBtn.style.opacity = '1'; 
    yesBtn.style.pointerEvents = 'auto'; 
    yesBtn.innerHTML = 'Yes';
    if (actionType === 'done') { 
        titleEl.innerText = "Mark as Done?";
        msgEl.innerText = "Are you sure this verification is completed?"; 
        iconEl.innerHTML = '<i class="ri-check-double-line" style="color: #10b981;"></i>'; 
        yesBtn.classList.add('btn-confirm-success'); 
        yesBtn.innerText = "Yes, Done";
    } else if (actionType === 'delete') { 
        titleEl.innerText = "Delete Record?";
        msgEl.innerText = "This action is permanent."; 
        iconEl.innerHTML = '<i class="ri-delete-bin-line" style="color: #ef4444;"></i>'; 
        yesBtn.classList.add('btn-confirm-danger'); 
        yesBtn.innerText = "Yes, Delete";
    } else if (actionType === 'pay') { 
        titleEl.innerText = "Mark as Paid?";
        msgEl.innerText = "Are you sure you want to mark this bill as paid?"; 
        iconEl.innerHTML = '<i class="ri-money-rupee-circle-line" style="color: #10b981;"></i>'; 
        yesBtn.classList.add('btn-confirm-success');
        yesBtn.innerText = "Yes, Paid"; 
    } else if (actionType === 'payAll') { 
        titleEl.innerText = "Mark ALL Paid?";
        msgEl.innerText = "Are you sure you want to mark ALL pending bills as paid?"; 
        iconEl.innerHTML = '<i class="ri-checkbox-multiple-line" style="color: #10b981;"></i>';
        yesBtn.classList.add('btn-confirm-success'); 
        yesBtn.innerText = "Yes, Mark All"; 
    } else if (actionType === 'logout') { 
        titleEl.innerText = "Secure Logout?";
        msgEl.innerText = "Are you sure you want to end your session?"; 
        iconEl.innerHTML = '<i class="ri-logout-circle-line" style="color: #ef4444;"></i>'; 
        yesBtn.classList.add('btn-confirm-danger');
        yesBtn.innerText = "Yes, Logout"; 
    }
    
    m.style.display = 'flex'; 
    setTimeout(() => m.classList.add('active'), 10);
};

window.closeConfirmModal = function() { 
    const m = document.getElementById('customConfirmModal');
    if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } 
    window.formToSubmit = null; 
};

// --- REMARKS MODAL ---
window.openRemarksModal = function(btn) { 
    const rTitle = document.getElementById('remarksTitle'); 
    const rBody = document.getElementById('remarksBody');
    const rModal = document.getElementById('remarksModal'); 
    if(rTitle && rBody && rModal) { 
        rTitle.innerText = btn.getAttribute('data-name');
        rBody.innerText = btn.getAttribute('data-remarks'); 
        rModal.style.display = 'flex'; 
        setTimeout(() => rModal.classList.add('active'), 10);
    } 
};

window.closeRemarksModal = function() { 
    const m = document.getElementById('remarksModal');
    if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } 
};

// --- WHATSAPP TEMPLATES ---
window.openWaModal = function(phone, name, type, billDate) {
    const m = document.getElementById('waTemplateModal');
    if(!m) return;
    
    let pInput = document.getElementById('waPhone'); 
    let nInput = document.getElementById('waName');
    let bInput = document.getElementById('waBillDate');
    
    if(!pInput) { pInput = document.createElement('input'); pInput.type = 'hidden'; pInput.id = 'waPhone'; m.appendChild(pInput); }
    if(!nInput) { nInput = document.createElement('input'); nInput.type = 'hidden'; nInput.id = 'waName'; m.appendChild(nInput); }
    if(!bInput) { bInput = document.createElement('input'); bInput.type = 'hidden'; bInput.id = 'waBillDate'; m.appendChild(bInput); }
    
    pInput.value = phone; 
    nInput.value = name || '';
    bInput.value = billDate || '';
    
    const verSection = document.getElementById('waVerTemplates'); 
    const pddSection = document.getElementById('waPddTemplates');
    
    if(type === 'pdd') { 
        if(verSection) verSection.style.display = 'none';
        if(pddSection) pddSection.style.display = 'block'; 
    } else { 
        if(verSection) verSection.style.display = 'block';
        if(pddSection) pddSection.style.display = 'none'; 
    }
    
    m.style.display = 'flex'; 
    setTimeout(() => m.classList.add('active'), 10);
};

window.closeWaModal = function() { 
    const m = document.getElementById('waTemplateModal');
    if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } 
};

window.sendWaTemplate = function(element) {
    const phone = document.getElementById('waPhone').value; 
    let name = document.getElementById('waName').value;
    let billDate = document.getElementById('waBillDate').value;
    if(!name || name.trim() === '') name = "Sir/Ma'am";
    
    let text = element.getAttribute('data-text'); 
    text = text.replace(/{{name}}/g, name);
    text = text.replace(/{{billDate}}/g, billDate);
    window.location.href = `whatsapp://send?phone=91${phone}&text=${encodeURIComponent(text)}`; 
    window.closeWaModal();
};

// --- INFINITE SCROLL ---
let isFetching = false;
window.addEventListener('scroll', async () => {
    const grid = document.querySelector('.grid-layout'); 
    if (!grid) return; 
    
    let current = parseInt(grid.getAttribute('data-current-page')) || 1; 
    let total = parseInt(grid.getAttribute('data-total-pages')) || 1;
    
    if (isFetching || current >= total) return;
    
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 150) {
        isFetching = true; 
        const spinner = document.getElementById('autoLoadSpinner'); 
        if(spinner) spinner.style.display = 'block';
        
        current++; 
        const url = new URL(window.location.href); 
        url.searchParams.set('page', current);
        
        try {
            const response = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }); 
            const html = await response.text(); 
            const parser = new DOMParser(); 
            const doc = parser.parseFromString(html, 'text/html'); 
            const newCards = doc.querySelectorAll('.grid-layout .card');
            newCards.forEach(card => grid.appendChild(card)); 
            grid.setAttribute('data-current-page', current); 
            
            const mainApp = document.getElementById('app-main'); 
            if(mainApp) window.appCache[window.location.pathname + window.location.search] = mainApp.innerHTML;
        } catch (e) { 
            console.error('Auto Load Error', e);
        } finally { 
            isFetching = false;
            if(spinner) spinner.style.display = 'none'; 
        }
    }
});