// public/app.js
// =====================================================================
// SMART SPA CACHE & BACKGROUND REVALIDATION SCRIPT
// =====================================================================

window.appCache = window.appCache || {};
window.fpAdd = null;
window.fpEdit = null;
window.formToSubmit = null;
const fpConfig = { dateFormat: "Y-m-d", altInput: true, altFormat: "d/m/Y", allowInput: true, disableMobile: true };

// Chart Rendering Logic
function renderChart(chartCanvas) {
    if (window.myPieChart) window.myPieChart.destroy(); 
    const nc = parseInt(chartCanvas.getAttribute('data-nc')) || 0;
    const p2p = parseInt(chartCanvas.getAttribute('data-p2p')) || 0;
    const mnp = parseInt(chartCanvas.getAttribute('data-mnp')) || 0;
    const nmnp = parseInt(chartCanvas.getAttribute('data-nmnp')) || 0;
    const fam = parseInt(chartCanvas.getAttribute('data-family')) || 0;
    const total = nc + p2p + mnp + nmnp + fam;

    if (total > 0) {
        const ctx = chartCanvas.getContext('2d');
        window.myPieChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['NC', 'P2P', 'MNP', 'NMNP', 'Family'],
                datasets: [{
                    data: [nc, p2p, mnp, nmnp, fam],
                    backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#db2777'],
                    borderWidth: 0, hoverOffset: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '70%',
                plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 15, font: { family: "'Inter', sans-serif", size: 12, weight: 500 } } } }
            }
        });
    } else {
        chartCanvas.parentElement.innerHTML = '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:0.95rem; font-weight:500;">No Data For Selected Month</div>';
    }
}

function initApp() {
    const addEl = document.getElementById("customDate");
    if(addEl) window.fpAdd = flatpickr(addEl, fpConfig);
    const editEl = document.getElementById("editDate");
    if(editEl) window.fpEdit = flatpickr(editEl, fpConfig);

    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.closest('form') && searchInput.closest('form').action.includes('/search')) {
        if (!searchInput.dataset.listenerAttached) {
            searchInput.addEventListener('input', function() {
                clearTimeout(window.typingTimer);
                const query = this.value.trim();
                const searchIcon = document.getElementById('searchIcon');
                const loadingIcon = document.getElementById('loadingIcon');
                if(searchIcon) searchIcon.style.display = 'none';
                if(loadingIcon) loadingIcon.style.display = 'block';
                window.typingTimer = setTimeout(() => performLiveSearch(query), 400);
            });
            searchInput.dataset.listenerAttached = 'true';
        }
    }

    const chartCanvas = document.getElementById('categoryChart');
    if (chartCanvas) {
        if (window.Chart) { renderChart(chartCanvas); } 
        else {
            const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
            script.onload = () => renderChart(chartCanvas); document.head.appendChild(script);
        }
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
    sessionStorage.removeItem('scrollPos'); sessionStorage.removeItem('scrollPath');
});

async function navigateTo(url, push = true) {
    document.querySelectorAll('.bottom-nav .nav-item').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === url.split('?')[0] || (url === '/' && link.getAttribute('href') === '/')) { link.classList.add('active'); }
    });
    const mainApp = document.getElementById('app-main');
    const cacheKey = url;

    if (window.appCache[cacheKey]) {
        if(mainApp) mainApp.innerHTML = window.appCache[cacheKey];
        if (push) history.pushState({}, '', url);
        initApp(); silentRevalidate(url, cacheKey);
        return; 
    }

    if(mainApp) {
        mainApp.innerHTML = `<div class="container" style="padding-top: 10px;"><div style="display:flex; align-items:center; gap:10px; margin-bottom:20px;"><div class="skeleton" style="height:32px; width:32px; border-radius:8px;"></div><div class="skeleton" style="height:28px; width:150px; border-radius:6px;"></div></div><div class="skeleton" style="height:48px; width:100%; border-radius:50px; margin-bottom:25px;"></div><div class="grid-layout">${'<div class="skeleton-card"><div class="sk-top"><div class="skeleton sk-badge"></div><div class="skeleton sk-date"></div></div><div class="skeleton sk-title"></div><div class="skeleton sk-text"></div><div class="skeleton sk-text-short"></div><div class="sk-actions"><div class="skeleton sk-btn"></div><div class="skeleton sk-btn"></div></div></div>'.repeat(6)}</div></div>`;
    }
    window.scrollTo(0,0);

    try {
        const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const html = await res.text(); const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html');
        document.title = doc.title;
        const newMain = doc.getElementById('app-main');
        if (newMain && mainApp) {
            const finalHTML = newMain.innerHTML; mainApp.innerHTML = finalHTML;
            window.appCache[cacheKey] = finalHTML; 
            if (push) history.pushState({}, '', url);
            initApp();
        } else { window.location.href = url; }
    } catch (err) { window.location.href = url; }
}

async function silentRevalidate(url, cacheKey) {
    try {
        const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const html = await res.text(); const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html');
        const newMain = doc.getElementById('app-main');
        if (newMain) {
            const freshHTML = newMain.innerHTML;
            if (window.appCache[cacheKey] !== freshHTML) {
                window.appCache[cacheKey] = freshHTML;
                const mainApp = document.getElementById('app-main');
                const isCurrentUrl = (window.location.pathname + window.location.search) === url;
                const isTyping = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
                if (mainApp && isCurrentUrl && !isTyping) { mainApp.innerHTML = freshHTML; initApp(); }
            }
        }
    } catch(e) {}
}

document.addEventListener('click', e => {
    const navItem = e.target.closest('.bottom-nav .nav-item');
    if (navItem && navItem.getAttribute('href') && navItem.getAttribute('href') !== '#' && !navItem.getAttribute('onclick')) {
        e.preventDefault(); if(!navItem.classList.contains('active')) { navigateTo(navItem.getAttribute('href')); }
    }
});

window.addEventListener('popstate', () => { navigateTo(window.location.pathname + window.location.search, false); });

window.handleFilterChange = function(e, selectEl) {
    e.preventDefault();
    const form = selectEl.closest('form'); const url = new URL(form.action || window.location.href, window.location.origin);
    url.searchParams.set(selectEl.name, selectEl.value); navigateTo(url.pathname + url.search);
}

window.filterList = function() { 
    const input = document.getElementById('searchInput'); if(!input) return;
    const filter = input.value.toLowerCase(); const items = document.getElementsByClassName('search-item'); 
    for (let i = 0; i < items.length; i++) { 
        if (items[i].innerText.toLowerCase().includes(filter)) items[i].style.display = ""; else items[i].style.display = "none"; 
    } 
}

async function performLiveSearch(query) {
    const targetUrl = query ? `/search?q=${encodeURIComponent(query)}` : '/search';
    window.history.replaceState(null, '', targetUrl); 
    try {
        const response = await fetch(targetUrl); const html = await response.text();
        const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html');
        const newResults = doc.getElementById('searchResultsArea'); const currentResults = document.getElementById('searchResultsArea');
        if (newResults && currentResults) { currentResults.innerHTML = newResults.innerHTML; }
    } catch (err) {} 
    finally {
        const sIcon = document.getElementById('searchIcon'); const lIcon = document.getElementById('loadingIcon');
        if(sIcon) sIcon.style.display = 'block'; if(lIcon) lIcon.style.display = 'none';
    }
}

// MODALS AND PLAN DROPDOWN LOGIC
window.openModal = function() { const m = document.getElementById("addModal"); if(!m) return; m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10); if(window.fpAdd) window.fpAdd.setDate(new Date()); window.handleCategoryChange(false); }
window.closeModal = function() { const m = document.getElementById("addModal"); if(!m) return; m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); }

window.handleCategoryChange = function(isEdit = false) { 
    const prefix = isEdit ? 'edit' : '';
    const cat = document.getElementById(prefix + (isEdit ? 'Category' : 'category'))?.value;
    const nForm = document.getElementById(prefix + (isEdit ? '-normal-form' : 'normal-form')); 
    const fForm = document.getElementById(prefix + (isEdit ? '-family-form' : 'family-form')); 
    const planSelect = document.getElementById(prefix + (isEdit ? 'Plan' : 'plan'));

    if(!nForm || !fForm) return; 
    nForm.classList.remove('active'); fForm.classList.remove('active'); 
    
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
}

window.openEditModal = function(btn) { 
    const form = document.getElementById('editForm'); const delForm = document.getElementById('deleteForm');
    if(!form || !delForm) return;
    form.action = "/edit/" + btn.getAttribute('data-id'); delForm.action = "/delete/" + btn.getAttribute('data-id'); 
    
    const cat = btn.getAttribute('data-category');
    document.getElementById('editCategory').value = cat;
    window.handleCategoryChange(true);
    
    const savedPlan = btn.getAttribute('data-plan') || (cat === 'Family' ? '701' : '451');
    if(document.getElementById('editPlan')) document.getElementById('editPlan').value = savedPlan;

    if(window.fpEdit) window.fpEdit.setDate(btn.getAttribute('data-date'));
    document.getElementById('editRemarks').value = btn.getAttribute('data-remarks') || ''; 
    document.getElementById('editBillDate').value = btn.getAttribute('data-billdate') || '';
    
    if (cat === 'Family') { 
        const pStatus = btn.getAttribute('data-p-status');
        let pType = 'Existing';
        if (pStatus.includes('NMNP')) pType = 'NMNP'; else if (pStatus.includes('MNP')) pType = 'MNP';
        else if (pStatus.includes('NC')) pType = 'NC'; else if (pStatus.includes('P2P')) pType = 'P2P'; 
        
        document.getElementById('editPType').value = pType; document.getElementById('editPName').value = btn.getAttribute('data-p-name');
        document.getElementById('editPMobile').value = btn.getAttribute('data-p-mobile'); document.getElementById('editSType').value = btn.getAttribute('data-subtype'); 
        document.getElementById('editSName').value = btn.getAttribute('data-name'); document.getElementById('editSMobile').value = btn.getAttribute('data-mobile');
    } else { 
        document.getElementById('editNName').value = btn.getAttribute('data-name');
        document.getElementById('editNMobile').value = btn.getAttribute('data-mobile'); document.getElementById('editSType').value = cat; 
    } 
    
    const m = document.getElementById("editModal"); m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10); 
}

window.closeEditModal = function() { const m = document.getElementById("editModal"); if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } }

window.openRemarksModal = function(btn) {
    const rTitle = document.getElementById('remarksTitle'); const rBody = document.getElementById('remarksBody'); const rModal = document.getElementById('remarksModal');
    if(rTitle && rBody && rModal) { rTitle.innerText = btn.getAttribute('data-name'); rBody.innerText = btn.getAttribute('data-remarks'); rModal.style.display = 'flex'; setTimeout(() => rModal.classList.add('active'), 10); }
}
window.closeRemarksModal = function() { const m = document.getElementById('remarksModal'); if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } }

window.openConfirmModal = function(event, element, actionType) {
    if(event) event.preventDefault(); window.formToSubmit = element || '/logout';
    const titleEl = document.getElementById('confirmTitle'); const msgEl = document.getElementById('confirmMessage'); const iconEl = document.getElementById('confirmIcon'); const yesBtn = document.getElementById('confirmYesBtn'); const m = document.getElementById('customConfirmModal');
    if(!m) return; yesBtn.className = 'btn-confirm-yes';
    
    // Reset button state incase it was left spinning
    yesBtn.style.opacity = '1'; yesBtn.style.pointerEvents = 'auto';

    if (actionType === 'done') { titleEl.innerText = "Mark as Done?"; msgEl.innerText = "Are you sure this verification is completed?"; iconEl.innerHTML = '<i class="ri-check-double-line" style="color: #10b981;"></i>'; yesBtn.classList.add('btn-confirm-success'); yesBtn.innerText = "Yes, Done"; } 
    else if (actionType === 'delete') { titleEl.innerText = "Delete Record?"; msgEl.innerText = "This action is permanent."; iconEl.innerHTML = '<i class="ri-delete-bin-line" style="color: #ef4444;"></i>'; yesBtn.classList.add('btn-confirm-danger'); yesBtn.innerText = "Yes, Delete"; } 
    else if (actionType === 'pay') { titleEl.innerText = "Mark as Paid?"; msgEl.innerText = "Are you sure you want to mark this bill as paid?"; iconEl.innerHTML = '<i class="ri-money-rupee-circle-line" style="color: #10b981;"></i>'; yesBtn.classList.add('btn-confirm-success'); yesBtn.innerText = "Yes, Paid"; } 
    else if (actionType === 'payAll') { titleEl.innerText = "Mark ALL Paid?"; msgEl.innerText = "Are you sure you want to mark ALL pending bills as paid?"; iconEl.innerHTML = '<i class="ri-checkbox-multiple-line" style="color: #10b981;"></i>'; yesBtn.classList.add('btn-confirm-success'); yesBtn.innerText = "Yes, Mark All"; } 
    else if (actionType === 'logout') { titleEl.innerText = "Secure Logout?"; msgEl.innerText = "Are you sure you want to end your session?"; iconEl.innerHTML = '<i class="ri-logout-circle-line" style="color: #ef4444;"></i>'; yesBtn.classList.add('btn-confirm-danger'); yesBtn.innerText = "Yes, Logout"; }
    m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10);
}

window.closeConfirmModal = function() { const m = document.getElementById('customConfirmModal'); if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } window.formToSubmit = null; }

// --- EVENT DELEGATION & GLOBAL BUTTON SPINNERS ---
document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'confirmYesBtn') {
        const btn = e.target;
        
        // Show spinner on the "Yes" button
        btn.innerHTML = '<i class="ri-loader-4-line btn-spinner"></i> Processing...';
        btn.style.opacity = '0.7';
        btn.style.pointerEvents = 'none';

        if (window.formToSubmit) {
            if (typeof window.formToSubmit === 'string') { window.location.href = window.formToSubmit; } 
            else {
                let returnInput = window.formToSubmit.querySelector('input[name="returnUrl"]');
                if (!returnInput) { returnInput = document.createElement('input'); returnInput.type = 'hidden'; returnInput.name = 'returnUrl'; window.formToSubmit.appendChild(returnInput); }
                returnInput.value = window.location.pathname + window.location.search;
                sessionStorage.setItem('scrollPos', window.scrollY); sessionStorage.setItem('scrollPath', window.location.pathname + window.location.search);
                delete window.appCache[window.location.pathname + window.location.search]; 
                window.formToSubmit.submit();
            }
        }
    }
    if (e.target.classList.contains('modal-overlay')) { e.target.classList.remove('active'); setTimeout(() => e.target.style.display = 'none', 300); }
});

document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.id === 'addForm' || form.id === 'editForm') {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            if (submitBtn.dataset.loading === 'true') { e.preventDefault(); return; }
            submitBtn.dataset.loading = 'true';
            submitBtn.innerHTML = `<i class="ri-loader-4-line btn-spinner"></i> ${form.id === 'addForm' ? 'Saving...' : 'Updating...'}`;
            submitBtn.style.opacity = '0.7'; submitBtn.style.cursor = 'not-allowed';
        }
    }
    if(form.getAttribute('action') !== '/search' && !form.getAttribute('onsubmit') && form.id !== 'loginForm') {
        let returnInput = form.querySelector('input[name="returnUrl"]');
        if (!returnInput) { returnInput = document.createElement('input'); returnInput.type = 'hidden'; returnInput.name = 'returnUrl'; form.appendChild(returnInput); }
        returnInput.value = window.location.pathname + window.location.search;
        sessionStorage.setItem('scrollPos', window.scrollY); sessionStorage.setItem('scrollPath', window.location.pathname + window.location.search);
        delete window.appCache[window.location.pathname + window.location.search];
    }
});

let isFetching = false;
window.addEventListener('scroll', async () => {
    const grid = document.querySelector('.grid-layout'); if (!grid) return;
    let current = parseInt(grid.getAttribute('data-current-page')) || 1; let total = parseInt(grid.getAttribute('data-total-pages')) || 1;
    if (isFetching || current >= total) return;
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 150) {
        isFetching = true; const spinner = document.getElementById('autoLoadSpinner'); if(spinner) spinner.style.display = 'block';
        current++; const url = new URL(window.location.href); url.searchParams.set('page', current);
        try {
            const response = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }); const html = await response.text();
            const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html');
            const newCards = doc.querySelectorAll('.grid-layout .card'); newCards.forEach(card => grid.appendChild(card));
            grid.setAttribute('data-current-page', current);
            const mainApp = document.getElementById('app-main'); if(mainApp) window.appCache[window.location.pathname + window.location.search] = mainApp.innerHTML;
        } catch (e) {} finally { isFetching = false; if(spinner) spinner.style.display = 'none'; }
    }
});