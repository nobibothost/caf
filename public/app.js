// public/app.js
// =====================================================================
// SMART SPA CACHE, BACKGROUND REVALIDATION, PWA & TOASTS
// =====================================================================

window.appCache = window.appCache || {};
window.fpAdd = null; window.fpEdit = null; window.formToSubmit = null;
const fpConfig = { dateFormat: "Y-m-d", altInput: true, altFormat: "d/m/Y", allowInput: true, disableMobile: true };

// --- 1. PWA SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW Reg Failed', err));
    });
}

// --- 2. TOAST NOTIFICATION SYSTEM ---
window.showToast = function(msg, type = 'success') {
    let tc = document.getElementById('toast-container');
    if(!tc) { tc = document.createElement('div'); tc.id = 'toast-container'; document.body.appendChild(tc); }
    const icon = type === 'success' ? 'ri-checkbox-circle-fill' : (type === 'error' ? 'ri-error-warning-fill' : 'ri-information-fill');
    const color = type === 'success' ? '#10b981' : (type === 'error' ? '#ef4444' : '#3b82f6');
    const t = document.createElement('div'); t.className = `toast ${type}`;
    t.innerHTML = `<i class="${icon}" style="color:${color}; font-size:1.2rem;"></i> ${msg}`;
    tc.appendChild(t); setTimeout(() => t.remove(), 3000);
}

// --- 3. SMART HIGHLIGHT SYSTEM ---
window.highlightSearch = function(query) {
    document.querySelectorAll('.customer-name, .mobile-txt, .fs-info p, .fs-info h4').forEach(el => {
        el.innerHTML = el.innerHTML.replace(/<\/?mark>/gi, ''); 
        if(!query) return;
        const textNodes = Array.from(el.childNodes).filter(node => node.nodeType === 3);
        textNodes.forEach(node => {
            const text = node.nodeValue;
            const regex = new RegExp(`(${query})`, 'gi');
            if(regex.test(text)) {
                const span = document.createElement('span');
                span.innerHTML = text.replace(regex, '<mark>$1</mark>');
                node.replaceWith(...span.childNodes);
            }
        });
    });
}

// --- 4. NETWORK STATUS MANAGER ---
function initNetworkManager() {
    let banner = document.getElementById('networkStatusBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'networkStatusBanner';
        banner.className = 'network-status-banner';
        document.body.appendChild(banner);
    }

    function updateNetworkStatus(e) {
        if (navigator.onLine) {
            banner.innerHTML = '<i class="ri-wifi-line"></i> Back online';
            banner.className = 'network-status-banner online show';
            setTimeout(() => {
                if (navigator.onLine) {
                    banner.classList.remove('show');
                }
            }, 3000);
        } else {
            banner.innerHTML = '<i class="ri-wifi-off-line"></i> No connection';
            banner.className = 'network-status-banner offline show';
        }
    }

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
}

// --- APP INITIALIZATION ---
function initApp() {
    const addEl = document.getElementById("customDate"); if(addEl) window.fpAdd = flatpickr(addEl, fpConfig);
    const editEl = document.getElementById("editDate"); if(editEl) window.fpEdit = flatpickr(editEl, fpConfig);
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.closest('form') && searchInput.closest('form').action.includes('/search')) {
        if (!searchInput.dataset.listenerAttached) {
            searchInput.addEventListener('input', function() {
                clearTimeout(window.typingTimer); const query = this.value.trim();
                const searchIcon = document.getElementById('searchIcon'); const loadingIcon = document.getElementById('loadingIcon');
                if(searchIcon) searchIcon.style.display = 'none'; if(loadingIcon) loadingIcon.style.display = 'block';
                window.highlightSearch(query); 
                window.typingTimer = setTimeout(() => performLiveSearch(query), 400);
            });
            searchInput.dataset.listenerAttached = 'true';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    initNetworkManager();
    
    // Inject Chrome-like PTR Spinner DOM
    if (!document.getElementById('ptr-spinner-container')) {
        const ptrDiv = document.createElement('div');
        ptrDiv.id = 'ptr-spinner-container';
        ptrDiv.className = 'ptr-spinner-container';
        ptrDiv.innerHTML = '<div class="ptr-icon"><i class="ri-refresh-line"></i></div>';
        document.body.appendChild(ptrDiv);
    }

    const scrollPath = sessionStorage.getItem('scrollPath');
    const currentPath = window.location.pathname + window.location.search;
    if (scrollPath === currentPath) { const scrollPos = sessionStorage.getItem('scrollPos'); if (scrollPos) setTimeout(() => window.scrollTo(0, parseInt(scrollPos)), 50); }
    sessionStorage.removeItem('scrollPos'); sessionStorage.removeItem('scrollPath');
});

// --- SPA ROUTING ---
async function navigateTo(url, push = true) {
    document.querySelectorAll('.bottom-nav .nav-item').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === url.split('?')[0] || (url === '/' && link.getAttribute('href') === '/')) link.classList.add('active');
    });
    const mainApp = document.getElementById('app-main'); const cacheKey = url;

    if (window.appCache[cacheKey]) {
        if(mainApp) mainApp.innerHTML = window.appCache[cacheKey];
        if (push) history.pushState({}, '', url); initApp(); silentRevalidate(url, cacheKey); return; 
    }

    if(mainApp) {
        mainApp.innerHTML = `<div class="container" style="padding-top:10px;"><div style="display:flex; align-items:center; gap:10px; margin-bottom:20px;"><div class="skeleton" style="height:32px; width:32px; border-radius:8px;"></div><div class="skeleton" style="height:28px; width:150px; border-radius:6px;"></div></div><div class="skeleton" style="height:48px; width:100%; border-radius:50px; margin-bottom:25px;"></div><div class="grid-layout">${'<div class="skeleton-card"><div class="sk-top"><div class="skeleton sk-badge"></div><div class="skeleton sk-date"></div></div><div class="skeleton sk-title"></div><div class="skeleton sk-text"></div><div class="skeleton sk-text-short"></div><div class="sk-actions"><div class="skeleton sk-btn"></div><div class="skeleton sk-btn"></div></div></div>'.repeat(6)}</div></div>`;
    }
    window.scrollTo(0,0);

    try {
        const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const html = await res.text(); const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html');
        document.title = doc.title; const newMain = doc.getElementById('app-main');
        if (newMain && mainApp) { mainApp.innerHTML = newMain.innerHTML; window.appCache[cacheKey] = newMain.innerHTML; if (push) history.pushState({}, '', url); initApp(); } 
        else window.location.href = url; 
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
                const mainApp = document.getElementById('app-main'); const isCurrentUrl = (window.location.pathname + window.location.search) === url;
                const isTyping = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
                if (mainApp && isCurrentUrl && !isTyping) { mainApp.innerHTML = freshHTML; initApp(); }
            }
        }
    } catch(e) {}
}

document.addEventListener('click', e => {
    const navItem = e.target.closest('.bottom-nav .nav-item');
    if (navItem && navItem.getAttribute('href') && navItem.getAttribute('href') !== '#' && !navItem.getAttribute('onclick')) {
        e.preventDefault(); if(!navItem.classList.contains('active')) navigateTo(navItem.getAttribute('href'));
    }
});

window.addEventListener('popstate', () => navigateTo(window.location.pathname + window.location.search, false));

window.handleFilterChange = function(e, selectEl) {
    e.preventDefault(); const form = selectEl.closest('form'); const url = new URL(form.action || window.location.href, window.location.origin);
    url.searchParams.set(selectEl.name, selectEl.value); navigateTo(url.pathname + url.search);
}

window.filterList = function() { 
    const input = document.getElementById('searchInput'); if(!input) return;
    const filter = input.value.toLowerCase(); const items = document.getElementsByClassName('search-item'); 
    for (let i = 0; i < items.length; i++) { 
        if (items[i].innerText.toLowerCase().includes(filter)) items[i].style.display = ""; else items[i].style.display = "none"; 
    } 
    window.highlightSearch(filter);
}

async function performLiveSearch(query) {
    const targetUrl = query ? `/search?q=${encodeURIComponent(query)}` : '/search';
    window.history.replaceState(null, '', targetUrl); 
    try {
        const response = await fetch(targetUrl); const html = await response.text();
        const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html');
        const newResults = doc.getElementById('searchResultsArea'); const currentResults = document.getElementById('searchResultsArea');
        if (newResults && currentResults) { currentResults.innerHTML = newResults.innerHTML; window.highlightSearch(query); }
    } catch (err) { console.error(err); } 
    finally {
        const sIcon = document.getElementById('searchIcon'); const lIcon = document.getElementById('loadingIcon');
        if(sIcon) sIcon.style.display = 'block'; if(lIcon) lIcon.style.display = 'none';
    }
}

// --- MODALS ---
window.openModal = function() { const m = document.getElementById("addModal"); if(!m) return; m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10); if(window.fpAdd) window.fpAdd.setDate(new Date()); window.handleCategoryChange(); }
window.closeModal = function() { const m = document.getElementById("addModal"); if(!m) return; m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); }
window.handleCategoryChange = function() { 
    const cat = document.getElementById('category')?.value; const nForm = document.getElementById('normal-form'); const fForm = document.getElementById('family-form'); 
    if(!nForm || !fForm) return; nForm.classList.remove('active'); fForm.classList.remove('active'); 
    if (cat === 'Family') { fForm.classList.add('active'); document.getElementById('n_name').required = false; document.getElementById('n_mobile').required = false; } 
    else { nForm.classList.add('active'); document.getElementById('n_name').required = true; document.getElementById('n_mobile').required = true; } 
}
window.openEditModal = function(btn) { 
    const form = document.getElementById('editForm'); const delForm = document.getElementById('deleteForm'); if(!form || !delForm) return;
    form.action = "/edit/" + btn.getAttribute('data-id'); delForm.action = "/delete/" + btn.getAttribute('data-id'); 
    const cat = btn.getAttribute('data-category'); document.getElementById('editCategory').value = cat;
    if(window.fpEdit) window.fpEdit.setDate(btn.getAttribute('data-date'));
    document.getElementById('editRemarks').value = btn.getAttribute('data-remarks') || ''; document.getElementById('editBillDate').value = btn.getAttribute('data-billdate') || '';
    if (cat === 'Family') { 
        const pStatus = btn.getAttribute('data-p-status'); let pType = 'Existing';
        if (pStatus.includes('NMNP')) pType = 'NMNP'; else if (pStatus.includes('MNP')) pType = 'MNP'; else if (pStatus.includes('NC')) pType = 'NC'; else if (pStatus.includes('P2P')) pType = 'P2P'; 
        document.getElementById('editPType').value = pType; document.getElementById('editPName').value = btn.getAttribute('data-p-name'); document.getElementById('editPMobile').value = btn.getAttribute('data-p-mobile'); document.getElementById('editSType').value = btn.getAttribute('data-subtype'); document.getElementById('editSName').value = btn.getAttribute('data-name'); document.getElementById('editSMobile').value = btn.getAttribute('data-mobile');
    } else { document.getElementById('editNName').value = btn.getAttribute('data-name'); document.getElementById('editNMobile').value = btn.getAttribute('data-mobile'); document.getElementById('editSType').value = cat; } 
    window.handleEditCategoryChange(); const m = document.getElementById("editModal"); m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10); 
}
window.closeEditModal = function() { const m = document.getElementById("editModal"); if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } }
window.handleEditCategoryChange = function() { 
    const cat = document.getElementById('editCategory')?.value; const nForm = document.getElementById('edit-normal-form'); const fForm = document.getElementById('edit-family-form'); 
    if(!nForm || !fForm) return; nForm.classList.remove('active'); fForm.classList.remove('active'); 
    if (cat === 'Family') { fForm.classList.add('active'); document.getElementById('editNName').required = false; document.getElementById('editNMobile').required = false; } 
    else { nForm.classList.add('active'); document.getElementById('editNName').required = true; document.getElementById('editNMobile').required = true; } 
}
window.openRemarksModal = function(btn) {
    const rTitle = document.getElementById('remarksTitle'); const rBody = document.getElementById('remarksBody'); const rModal = document.getElementById('remarksModal');
    if(rTitle && rBody && rModal) { rTitle.innerText = btn.getAttribute('data-name'); rBody.innerText = btn.getAttribute('data-remarks'); rModal.style.display = 'flex'; setTimeout(() => rModal.classList.add('active'), 10); }
}
window.closeRemarksModal = function() { const m = document.getElementById('remarksModal'); if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } }
window.openConfirmModal = function(event, element, actionType) {
    if(event) event.preventDefault(); window.formToSubmit = element || '/logout';
    const titleEl = document.getElementById('confirmTitle'); const msgEl = document.getElementById('confirmMessage'); const iconEl = document.getElementById('confirmIcon'); const yesBtn = document.getElementById('confirmYesBtn'); const m = document.getElementById('customConfirmModal');
    if(!m) return; yesBtn.className = 'btn-confirm-yes';
    if (actionType === 'done') { titleEl.innerText = "Mark as Done?"; msgEl.innerText = "Are you sure this verification is completed?"; iconEl.innerHTML = '<i class="ri-check-double-line" style="color: #10b981;"></i>'; yesBtn.classList.add('btn-confirm-success'); yesBtn.innerText = "Yes, Done"; } 
    else if (actionType === 'delete') { titleEl.innerText = "Delete Record?"; msgEl.innerText = "This action is permanent."; iconEl.innerHTML = '<i class="ri-delete-bin-line" style="color: #ef4444;"></i>'; yesBtn.classList.add('btn-confirm-danger'); yesBtn.innerText = "Yes, Delete"; } 
    else if (actionType === 'pay') { titleEl.innerText = "Mark as Paid?"; msgEl.innerText = "Are you sure you want to mark this bill as paid?"; iconEl.innerHTML = '<i class="ri-money-rupee-circle-line" style="color: #10b981;"></i>'; yesBtn.classList.add('btn-confirm-success'); yesBtn.innerText = "Yes, Paid"; } 
    else if (actionType === 'payAll') { titleEl.innerText = "Mark ALL Paid?"; msgEl.innerText = "Are you sure you want to mark ALL pending bills as paid?"; iconEl.innerHTML = '<i class="ri-checkbox-multiple-line" style="color: #10b981;"></i>'; yesBtn.classList.add('btn-confirm-success'); yesBtn.innerText = "Yes, Mark All"; } 
    else if (actionType === 'logout') { titleEl.innerText = "Secure Logout?"; msgEl.innerText = "Are you sure you want to end your session?"; iconEl.innerHTML = '<i class="ri-logout-circle-line" style="color: #ef4444;"></i>'; yesBtn.classList.add('btn-confirm-danger'); yesBtn.innerText = "Yes, Logout"; }
    m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10);
}
window.closeConfirmModal = function() { const m = document.getElementById('customConfirmModal'); if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } window.formToSubmit = null; }

// --- AJAX FORMS & TOASTS INTERCEPTION ---
document.addEventListener('click', async function(e) {
    if (e.target && e.target.id === 'confirmYesBtn') {
        if (window.formToSubmit) {
            if (typeof window.formToSubmit === 'string') { window.location.href = window.formToSubmit; } 
            else {
                const btn = e.target; const ogText = btn.innerHTML;
                btn.innerHTML = '<i class="ri-loader-4-line spin-loader" style="display:inline-block"></i> Processing...'; btn.disabled = true;
                try {
                    const url = window.formToSubmit.action; const fd = new FormData(window.formToSubmit);
                    await fetch(url, { method: 'POST', body: new URLSearchParams(fd) });
                    window.showToast('Action Completed Successfully!', 'success');
                    window.closeConfirmModal();
                    delete window.appCache[window.location.pathname + window.location.search];
                    navigateTo(window.location.pathname + window.location.search, false);
                } catch(err) { window.showToast('Action Failed', 'error'); } 
                finally { btn.innerHTML = ogText; btn.disabled = false; }
            }
        }
    }
    if (e.target.classList.contains('modal-overlay')) { e.target.classList.remove('active'); setTimeout(() => e.target.style.display = 'none', 300); }
});

document.addEventListener('submit', async function(e) {
    const form = e.target;
    if (form.id === 'addForm' || form.id === 'editForm') {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        if (btn.disabled) return;
        const ogText = btn.innerHTML;
        btn.innerHTML = `<i class="ri-loader-4-line btn-spinner"></i> Saving...`; btn.style.opacity = '0.7'; btn.disabled = true;
        try {
            await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)) });
            window.showToast('Record Saved Successfully!', 'success');
            window.closeModal(); window.closeEditModal();
            delete window.appCache[window.location.pathname + window.location.search];
            navigateTo(window.location.pathname + window.location.search, false);
        } catch(err) { window.showToast('Error Saving Record', 'error'); } 
        finally { btn.innerHTML = ogText; btn.style.opacity = '1'; btn.disabled = false; }
    } else if(form.getAttribute('action') !== '/search' && !form.getAttribute('onsubmit')) {
        e.preventDefault();
    }
});

// --- PULL TO REFRESH (NATIVE CHROME-STYLE RUBBER BAND) ---
let ptrTouchStartY = 0;
let isPtrRefreshing = false;

document.addEventListener('touchstart', e => {
    if (window.scrollY === 0 && !isPtrRefreshing) {
        ptrTouchStartY = e.touches[0].clientY;
    }
}, {passive: true});

document.addEventListener('touchmove', e => {
    if (window.scrollY === 0 && !isPtrRefreshing && ptrTouchStartY > 0) {
        const touchY = e.touches[0].clientY;
        const pullDist = Math.max(0, touchY - ptrTouchStartY);
        const ptr = document.getElementById('ptr-spinner-container');
        
        if (pullDist > 0 && ptr) {
            ptr.classList.add('pulling');
            
            // Rubber band effect physics (Math.pow creates tension)
            const moveY = Math.pow(pullDist, 0.75); 
            
            ptr.style.opacity = Math.min(1, pullDist / 80);
            ptr.style.top = `${-50 + moveY}px`;
            
            // Rotate the arrow icon as you pull
            const icon = ptr.querySelector('.ptr-icon');
            if (icon) icon.style.transform = `rotate(${pullDist * 2.5}deg)`;
        }
    }
}, {passive: true});

document.addEventListener('touchend', async e => {
    if (window.scrollY === 0 && !isPtrRefreshing && ptrTouchStartY > 0) {
        const touchEndY = e.changedTouches[0].clientY;
        const pullDist = Math.max(0, touchEndY - ptrTouchStartY);
        const ptr = document.getElementById('ptr-spinner-container');

        if (ptr) {
            ptr.classList.remove('pulling');
            const moveY = Math.pow(pullDist, 0.75);
            
            if (moveY > 45) { // Trigger refresh if pulled enough
                isPtrRefreshing = true;
                ptr.classList.add('refreshing');
                
                delete window.appCache[window.location.pathname + window.location.search];
                await navigateTo(window.location.pathname + window.location.search, false);
                
                ptr.classList.remove('refreshing');
                ptr.style.top = '-50px';
                ptr.style.opacity = '0';
                isPtrRefreshing = false;
            } else {
                // Snap back without refreshing
                ptr.style.top = '-50px';
                ptr.style.opacity = '0';
            }
        }
        ptrTouchStartY = 0;
    }
}, {passive: true});

// --- INFINITE SCROLL ---
let isFetching = false;
window.addEventListener('scroll', async () => {
    const grid = document.querySelector('.grid-layout');
    if (!grid) return;
    let current = parseInt(grid.getAttribute('data-current-page')) || 1; let total = parseInt(grid.getAttribute('data-total-pages')) || 1;
    if (isFetching || current >= total) return;
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 150) {
        isFetching = true; const spinner = document.getElementById('autoLoadSpinner'); if(spinner) spinner.style.display = 'block';
        current++; const url = new URL(window.location.href); url.searchParams.set('page', current);
        try {
            const response = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }); const html = await response.text();
            const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html');
            const newCards = doc.querySelectorAll('.grid-layout .card');
            newCards.forEach(card => grid.appendChild(card));
            grid.setAttribute('data-current-page', current);
            
            const sInput = document.getElementById('searchInput');
            if(sInput && sInput.value) window.highlightSearch(sInput.value);

            const mainApp = document.getElementById('app-main');
            if(mainApp) window.appCache[window.location.pathname + window.location.search] = mainApp.innerHTML;
        } catch (e) {} 
        finally { isFetching = false; if(spinner) spinner.style.display = 'none'; }
    }
});