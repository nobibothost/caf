// public/features.js
// =====================================================================
// UI FEATURES: CHARTS, FILTERS, SEARCH, SCROLL & LIVE WA DP
// =====================================================================

window.renderChart = function(chartCanvas) {
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
};

window.handleFilterChange = function(e, selectEl) { 
    const form = selectEl.closest('form'); 
    const url = new URL(form.action || window.location.href, window.location.origin); 
    url.searchParams.set(selectEl.name, selectEl.value); 
    if (selectEl.value !== 'custom') { url.searchParams.delete('start'); url.searchParams.delete('end'); }
    if (typeof window.navigateTo === 'function') window.navigateTo(url.pathname + url.search);
};

window.filterList = function() { 
    const input = document.getElementById('searchInput'); 
    if(!input) return; const filter = input.value.toLowerCase();
    const items = document.getElementsByClassName('search-item'); 
    for (let i = 0; i < items.length; i++) { 
        if (items[i].innerText.toLowerCase().includes(filter)) items[i].style.display = ""; else items[i].style.display = "none"; 
    } 
};

window.performLiveSearch = async function(query) {
    const targetUrl = query ? `/search?q=${encodeURIComponent(query)}` : '/search';
    window.history.replaceState(null, '', targetUrl); 
    try { 
        const response = await fetch(targetUrl); const html = await response.text(); 
        const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html'); 
        const newResults = doc.getElementById('searchResultsArea'); const currentResults = document.getElementById('searchResultsArea'); 
        if (newResults && currentResults) { 
            currentResults.innerHTML = newResults.innerHTML; 
            if (window.loadWhatsAppDPs) window.loadWhatsAppDPs();
        } 
    } catch (err) {} 
    finally { 
        const sIcon = document.getElementById('searchIcon'); const lIcon = document.getElementById('loadingIcon'); 
        if(sIcon) sIcon.style.display = 'block'; if(lIcon) lIcon.style.display = 'none';
    }
};

window.isFetching = false;
window.addEventListener('scroll', async () => {
    const grid = document.querySelector('.grid-layout'); if (!grid) return; 
    let current = parseInt(grid.getAttribute('data-current-page')) || 1; let total = parseInt(grid.getAttribute('data-total-pages')) || 1;
    if (window.isFetching || current >= total) return;
    
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 150) {
        window.isFetching = true; const spinner = document.getElementById('autoLoadSpinner'); if(spinner) spinner.style.display = 'block';
        current++; const url = new URL(window.location.href); url.searchParams.set('page', current);
        try {
            const response = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }); 
            const html = await response.text(); const parser = new DOMParser(); const doc = parser.parseFromString(html, 'text/html'); 
            const newCards = doc.querySelectorAll('.grid-layout .card'); 
            newCards.forEach(card => grid.appendChild(card)); 
            grid.setAttribute('data-current-page', current); 
            const mainApp = document.getElementById('app-main'); 
            if(mainApp) window.appCache[window.location.pathname + window.location.search] = mainApp.innerHTML;
            if (window.loadWhatsAppDPs) window.loadWhatsAppDPs();
        } catch (e) { } finally { window.isFetching = false; if(spinner) spinner.style.display = 'none'; }
    }
});

// =====================================================================
// WA DP LIVE FETCH LOGIC (No localStorage, pure proxy)
// =====================================================================
window.dpCache = window.dpCache || {};

window.loadWhatsAppDPs = async function() {
    const dpElements = document.querySelectorAll('.whatsapp-dp:not(.loaded)');
    
    dpElements.forEach(img => {
        const number = img.getAttribute('data-number');
        if (!number) {
            img.style.display = 'none';
            return;
        }
        
        img.classList.add('loaded'); // Mark to avoid duplicate calls
        
        // Session memory cache to prevent spamming on rapid scroll
        if (window.dpCache[number]) {
            if (window.dpCache[number] === 'none') {
                img.style.display = 'none';
            } else {
                img.src = window.dpCache[number];
                img.style.display = 'block';
            }
            return;
        }
        
        // Live Fetch URL
        const liveUrl = `/api/get-wa-dp/${number}`;
        
        // Use native browser loading events
        img.onload = () => {
            window.dpCache[number] = liveUrl;
            img.style.display = 'block';
        };
        
        img.onerror = () => {
            window.dpCache[number] = 'none';
            img.style.display = 'none'; // Fallback to background user icon
        };
        
        // Set src to trigger network request
        img.src = liveUrl;
    });
};

document.addEventListener('DOMContentLoaded', () => {
    if (window.loadWhatsAppDPs) window.loadWhatsAppDPs();
});