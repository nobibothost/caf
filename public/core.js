// public/core.js
// =====================================================================
// SMART SPA CORE & GLOBAL ENGINE
// =====================================================================

window.appCache = window.appCache || {};
window.fpAdd = null; 
window.fpEdit = null; 
window.formToSubmit = null;
window.fpConfig = { dateFormat: "Y-m-d", altInput: true, altFormat: "d/m/Y", allowInput: true, disableMobile: true };

window.initApp = function() {
    const addEl = document.getElementById("customDate"); 
    if(addEl) window.fpAdd = flatpickr(addEl, window.fpConfig);
    
    const editEl = document.getElementById("editDate"); 
    if(editEl) window.fpEdit = flatpickr(editEl, window.fpConfig);

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
                    url.searchParams.delete('month'); 
                    url.searchParams.set('start', startStr);
                    url.searchParams.set('end', endStr);
                    window.navigateTo(url.pathname + url.search);
                }
            }
        });
    }
    
    const chartCanvas = document.getElementById('categoryChart');
    if (chartCanvas && typeof window.renderChart === 'function') {
        if (window.Chart) window.renderChart(chartCanvas);
        else {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js'; 
            script.onload = () => window.renderChart(chartCanvas); 
            document.head.appendChild(script); 
        }
    }
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput && typeof window.filterList === 'function') {
        searchInput.removeEventListener('keyup', window.filterList);
        searchInput.addEventListener('keyup', window.filterList);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.initApp();
    const scrollPath = sessionStorage.getItem('scrollPath'); 
    const currentPath = window.location.pathname + window.location.search;
    if (scrollPath === currentPath) { 
        const scrollPos = sessionStorage.getItem('scrollPos'); 
        if (scrollPos) setTimeout(() => window.scrollTo(0, parseInt(scrollPos)), 50); 
    }
    sessionStorage.removeItem('scrollPos'); 
    sessionStorage.removeItem('scrollPath');
});

window.navigateTo = async function(url, push = true) {
    const mainApp = document.getElementById('app-main'); 
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
            
            document.querySelectorAll('.bottom-nav .nav-item').forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === url.split('?')[0]) link.classList.add('active');
            });

            window.initApp();
            window.scrollTo(0,0);
        } else { 
            window.location.href = url;
        }
    } catch (err) { 
        window.location.href = url; 
    }
};

window.addEventListener('popstate', () => window.navigateTo(window.location.pathname + window.location.search, false));

// GLOBAL CLICK DISPATCHER
document.addEventListener('click', e => {
    const navItem = e.target.closest('.bottom-nav .nav-item');
    if (navItem && navItem.getAttribute('href') && navItem.getAttribute('href') !== '#') {
        e.preventDefault(); window.navigateTo(navItem.getAttribute('href')); return;
    }

    const treeBtn = e.target.closest('.btn-view-tree');
    if (treeBtn && typeof window.openFamilyModal === 'function') {
        e.preventDefault(); window.openFamilyModal(treeBtn.getAttribute('data-tree-id')); return;
    }

    if (e.target.classList.contains('modal-overlay')) {
        if (e.target.id === 'familyTreeModal' && typeof window.closeFamilyModal === 'function') { window.closeFamilyModal(); } 
        else if (e.target.id === 'callLogModal' && typeof window.closeCallLogModal === 'function') { window.closeCallLogModal(); } 
        else { e.target.classList.remove('active'); setTimeout(() => e.target.style.display = 'none', 300); }
        return;
    }

    if (e.target.id === 'confirmYesBtn') {
        const btn = e.target; 
        btn.innerHTML = '<i class="ri-loader-4-line btn-spinner"></i> Processing...'; 
        btn.style.opacity = '0.7'; btn.style.pointerEvents = 'none';
        if (window.formToSubmit) {
            if (typeof window.formToSubmit === 'string') { window.location.href = window.formToSubmit; } 
            else {
                let returnInput = window.formToSubmit.querySelector('input[name="returnUrl"]');
                if (!returnInput) { 
                    returnInput = document.createElement('input'); returnInput.type = 'hidden'; returnInput.name = 'returnUrl'; window.formToSubmit.appendChild(returnInput); 
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