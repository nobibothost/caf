// public/app.js
// =====================================================================
// SMART SPA CACHE & BACKGROUND REVALIDATION SCRIPT
// =====================================================================

window.appCache = window.appCache || {};
window.fpAdd = null;
window.fpEdit = null;
window.formToSubmit = null;

const fpConfig = { dateFormat: "Y-m-d", altInput: true, altFormat: "d/m/Y", allowInput: true, disableMobile: true };

// --- APP INITIALIZATION ---
function initApp() {
    const addEl = document.getElementById("customDate");
    if(addEl) window.fpAdd = flatpickr(addEl, fpConfig);
    
    const editEl = document.getElementById("editDate");
    if(editEl) window.fpEdit = flatpickr(editEl, fpConfig);

    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.closest('form') && searchInput.closest('form').action.includes('/search')) {
        // Only attach event listener if it hasn't been attached yet to prevent double-firing
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

// --- INSTANT SKELETON, SMART CACHE & SPA ROUTING ---
async function navigateTo(url, push = true) {
    // Update Active Tab Instantly
    document.querySelectorAll('.bottom-nav .nav-item').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === url.split('?')[0] || (url === '/' && link.getAttribute('href') === '/')) {
            link.classList.add('active');
        }
    });

    const mainApp = document.getElementById('app-main');
    const cacheKey = url;

    // --- STEP 1: CACHE FIRST APPROACH ---
    if (window.appCache[cacheKey]) {
        if(mainApp) mainApp.innerHTML = window.appCache[cacheKey];
        if (push) history.pushState({}, '', url);
        initApp();
        
        // Background silent check for updates
        silentRevalidate(url, cacheKey);
        return; // Stop execution here, don't show skeleton
    }

    // --- STEP 2: SHOW SKELETON FOR FIRST TIME LOAD ---
    if(mainApp) {
        mainApp.innerHTML = `
            <div class="container" style="padding-top: 10px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:20px;">
                    <div class="skeleton" style="height:32px; width:32px; border-radius:8px;"></div>
                    <div class="skeleton" style="height:28px; width:150px; border-radius:6px;"></div>
                </div>
                <div class="skeleton" style="height:48px; width:100%; border-radius:50px; margin-bottom:25px;"></div>
                <div class="grid-layout">
                    ${'<div class="skeleton-card"><div class="sk-top"><div class="skeleton sk-badge"></div><div class="skeleton sk-date"></div></div><div class="skeleton sk-title"></div><div class="skeleton sk-text"></div><div class="skeleton sk-text-short"></div><div class="sk-actions"><div class="skeleton sk-btn"></div><div class="skeleton sk-btn"></div></div></div>'.repeat(6)}
                </div>
            </div>
        `;
    }
    window.scrollTo(0,0);

    // --- STEP 3: INITIAL FETCH ---
    try {
        const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        document.title = doc.title;
        const newMain = doc.getElementById('app-main');
        if (newMain && mainApp) {
            const finalHTML = newMain.innerHTML;
            mainApp.innerHTML = finalHTML;
            window.appCache[cacheKey] = finalHTML; // Store in Memory
            if (push) history.pushState({}, '', url);
            initApp(); 
        } else {
            window.location.href = url; // Fallback
        }
    } catch (err) {
        window.location.href = url;
    }
}

// --- SILENT BACKGROUND UPDATER ---
async function silentRevalidate(url, cacheKey) {
    try {
        const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const newMain = doc.getElementById('app-main');
        
        if (newMain) {
            const freshHTML = newMain.innerHTML;
            // If data has changed since we cached it
            if (window.appCache[cacheKey] !== freshHTML) {
                window.appCache[cacheKey] = freshHTML; // Update Cache silently
                
                const mainApp = document.getElementById('app-main');
                const isCurrentUrl = (window.location.pathname + window.location.search) === url;
                
                // Safety check: Don't replace DOM if user is actively typing in a search box
                const isTyping = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
                
                if (mainApp && isCurrentUrl && !isTyping) {
                    mainApp.innerHTML = freshHTML; // Inject fresh data into UI
                    initApp(); // Re-bind JS
                }
            }
        }
    } catch(e) { console.warn('Background sync failed silently.', e); }
}

// Intercept all bottom-nav clicks
document.addEventListener('click', e => {
    const navItem = e.target.closest('.bottom-nav .nav-item');
    if (navItem && navItem.getAttribute('href') && navItem.getAttribute('href') !== '#' && !navItem.getAttribute('onclick')) {
        e.preventDefault();
        if(!navItem.classList.contains('active')) {
            navigateTo(navItem.getAttribute('href'));
        }
    }
});

// Browser Back/Forward buttons
window.addEventListener('popstate', () => {
    navigateTo(window.location.pathname + window.location.search, false);
});

// Intercept Filter Dropdowns
function handleFilterChange(e, selectEl) {
    e.preventDefault();
    const form = selectEl.closest('form');
    const url = new URL(form.action || window.location.href, window.location.origin);
    url.searchParams.set(selectEl.name, selectEl.value);
    navigateTo(url.pathname + url.search);
}

// --- QUICK LOCAL SEARCH ---
function filterList() { 
    const input = document.getElementById('searchInput');
    if(!input) return;
    const filter = input.value.toLowerCase(); 
    const items = document.getElementsByClassName('search-item'); 
    for (let i = 0; i < items.length; i++) { 
        if (items[i].innerText.toLowerCase().includes(filter)) items[i].style.display = ""; 
        else items[i].style.display = "none"; 
    } 
}

// --- GLOBAL LIVE SEARCH (API) ---
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
    } catch (err) { console.error(err); } 
    finally {
        const sIcon = document.getElementById('searchIcon'); const lIcon = document.getElementById('loadingIcon');
        if(sIcon) sIcon.style.display = 'block';
        if(lIcon) lIcon.style.display = 'none';
    }
}

// --- MODAL CONTROLS ---
window.openModal = function() { const m = document.getElementById("addModal"); if(!m) return; m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10); if(window.fpAdd) window.fpAdd.setDate(new Date()); handleCategoryChange(); }
window.closeModal = function() { const m = document.getElementById("addModal"); if(!m) return; m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); }

window.handleCategoryChange = function() { 
    const cat = document.getElementById('category')?.value;
    const nForm = document.getElementById('normal-form'); const fForm = document.getElementById('family-form'); 
    if(!nForm || !fForm) return; 
    nForm.classList.remove('active'); fForm.classList.remove('active'); 
    if (cat === 'Family') { fForm.classList.add('active'); document.getElementById('n_name').required = false; document.getElementById('n_mobile').required = false; } 
    else { nForm.classList.add('active'); document.getElementById('n_name').required = true; document.getElementById('n_mobile').required = true; } 
}

window.openEditModal = function(btn) { 
    const form = document.getElementById('editForm'); const delForm = document.getElementById('deleteForm');
    if(!form || !delForm) return;
    form.action = "/edit/" + btn.getAttribute('data-id'); delForm.action = "/delete/" + btn.getAttribute('data-id'); 
    const cat = btn.getAttribute('data-category'); document.getElementById('editCategory').value = cat;
    if(window.fpEdit) window.fpEdit.setDate(btn.getAttribute('data-date'));
    document.getElementById('editRemarks').value = btn.getAttribute('data-remarks') || ''; document.getElementById('editBillDate').value = btn.getAttribute('data-billdate') || '';
    if (cat === 'Family') { 
        const pStatus = btn.getAttribute('data-p-status'); let pType = 'Existing';
        if (pStatus.includes('NMNP')) pType = 'NMNP'; else if (pStatus.includes('MNP')) pType = 'MNP'; else if (pStatus.includes('NC')) pType = 'NC'; else if (pStatus.includes('P2P')) pType = 'P2P'; 
        document.getElementById('editPType').value = pType; document.getElementById('editPName').value = btn.getAttribute('data-p-name'); document.getElementById('editPMobile').value = btn.getAttribute('data-p-mobile'); document.getElementById('editSType').value = btn.getAttribute('data-subtype'); document.getElementById('editSName').value = btn.getAttribute('data-name'); document.getElementById('editSMobile').value = btn.getAttribute('data-mobile');
    } else { document.getElementById('editNName').value = btn.getAttribute('data-name'); document.getElementById('editNMobile').value = btn.getAttribute('data-mobile'); document.getElementById('editSType').value = cat; } 
    handleEditCategoryChange(); 
    const m = document.getElementById("editModal"); m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10); 
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
    if(!m) return;
    yesBtn.className = 'btn-confirm-yes';
    if (actionType === 'done') { titleEl.innerText = "Mark as Done?"; msgEl.innerText = "Are you sure this verification is completed?"; iconEl.innerHTML = '<i class="ri-check-double-line" style="color: #10b981;"></i>'; yesBtn.classList.add('btn-confirm-success'); yesBtn.innerText = "Yes, Done"; } 
    else if (actionType === 'delete') { titleEl.innerText = "Delete Record?"; msgEl.innerText = "This action is permanent."; iconEl.innerHTML = '<i class="ri-delete-bin-line" style="color: #ef4444;"></i>'; yesBtn.classList.add('btn-confirm-danger'); yesBtn.innerText = "Yes, Delete"; } 
    else if (actionType === 'pay') { titleEl.innerText = "Mark as Paid?"; msgEl.innerText = "Are you sure you want to mark this bill as paid?"; iconEl.innerHTML = '<i class="ri-money-rupee-circle-line" style="color: #10b981;"></i>'; yesBtn.classList.add('btn-confirm-success'); yesBtn.innerText = "Yes, Paid"; } 
    else if (actionType === 'payAll') { titleEl.innerText = "Mark ALL Paid?"; msgEl.innerText = "Are you sure you want to mark ALL pending bills as paid?"; iconEl.innerHTML = '<i class="ri-checkbox-multiple-line" style="color: #10b981;"></i>'; yesBtn.classList.add('btn-confirm-success'); yesBtn.innerText = "Yes, Mark All"; } 
    else if (actionType === 'logout') { titleEl.innerText = "Secure Logout?"; msgEl.innerText = "Are you sure you want to end your session?"; iconEl.innerHTML = '<i class="ri-logout-circle-line" style="color: #ef4444;"></i>'; yesBtn.classList.add('btn-confirm-danger'); yesBtn.innerText = "Yes, Logout"; }
    m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10);
}

window.closeConfirmModal = function() { const m = document.getElementById('customConfirmModal'); if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } window.formToSubmit = null; }

// --- EVENT DELEGATION ---
document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'confirmYesBtn') {
        if (window.formToSubmit) {
            if (typeof window.formToSubmit === 'string') { window.location.href = window.formToSubmit; } 
            else {
                let returnInput = window.formToSubmit.querySelector('input[name="returnUrl"]');
                if (!returnInput) { returnInput = document.createElement('input'); returnInput.type = 'hidden'; returnInput.name = 'returnUrl'; window.formToSubmit.appendChild(returnInput); }
                returnInput.value = window.location.pathname + window.location.search;
                sessionStorage.setItem('scrollPos', window.scrollY); sessionStorage.setItem('scrollPath', window.location.pathname + window.location.search);
                
                // Clear cache for current page since we are modifying data
                delete window.appCache[window.location.pathname + window.location.search];
                window.formToSubmit.submit();
            }
        }
    }
    if (e.target.classList.contains('modal-overlay')) { e.target.classList.remove('active'); setTimeout(() => e.target.style.display = 'none', 300); }
});

document.addEventListener('submit', function(e) {
    const form = e.target;
    if(form.getAttribute('action') !== '/search' && !form.getAttribute('onsubmit')) {
        let returnInput = form.querySelector('input[name="returnUrl"]');
        if (!returnInput) { returnInput = document.createElement('input'); returnInput.type = 'hidden'; returnInput.name = 'returnUrl'; form.appendChild(returnInput); }
        returnInput.value = window.location.pathname + window.location.search;
        sessionStorage.setItem('scrollPos', window.scrollY); sessionStorage.setItem('scrollPath', window.location.pathname + window.location.search);
        // Clear cache
        delete window.appCache[window.location.pathname + window.location.search];
    }
});

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
            
            // Update cache string to include new items
            const mainApp = document.getElementById('app-main');
            if(mainApp) window.appCache[window.location.pathname + window.location.search] = mainApp.innerHTML;
        } catch (e) { console.error('Auto-load error', e); } 
        finally { isFetching = false; if(spinner) spinner.style.display = 'none'; }
    }
});