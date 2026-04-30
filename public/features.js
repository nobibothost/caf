// public/features.js
// =====================================================================
// UI FEATURES: CHARTS, FILTERS, SEARCH, SCROLL & LIVE WA DP LAZY LOAD
// =====================================================================

window.renderChart = function(chartCanvas) {
    if (window.myPieChart) window.myPieChart.destroy(); 
    
    // 🔥 PRECISE 5 METRICS MAPPING
    const dataValues = [
        parseInt(chartCanvas.getAttribute('data-mf')) || 0,
        parseInt(chartCanvas.getAttribute('data-of')) || 0,
        parseInt(chartCanvas.getAttribute('data-mnf')) || 0, 
        parseInt(chartCanvas.getAttribute('data-fnf')) || 0,
        parseInt(chartCanvas.getAttribute('data-pnf')) || 0
    ];
    
    if (dataValues.reduce((a, b) => a + b, 0) > 0) {
        const ctx = chartCanvas.getContext('2d');
        window.myPieChart = new Chart(ctx, {
            type: 'doughnut',
            data: { 
                labels: ['MNP Family', 'Other Family', 'MNP Non-Family', 'Fresh Non-Family', 'P2P Non-Family'], 
                datasets: [{ 
                    data: dataValues, 
                    backgroundColor: ['#ec4899', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6'], 
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
    if (typeof window.navigateTo === 'function') window.navigateTo(url.pathname + url.search); else window.location.href = url.pathname + url.search;
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
// 🔥 GLOBAL CACHING ENGINE FOR WHATSAPP DPs (INSTANT LOAD UPGRADE)
// =====================================================================

const WA_DEFAULT_DP = 'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iI2RmZTVlNyIvPjxwYXRoIGQ9Ik01MCA0OGExNCAxNCAwIDEwMC0yOCAxNCAxNCAwIDAwMCAyOHptMCA3Yy0xNiAwLTMxIDEwLTM0IDIzYTUwIDUwIDAgMDA2OCAwYy0zLTEzLTE4LTIzLTM0LTIzeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';
const CACHE_PREFIX = 'wadp_v6_';
const CACHE_TIME = 7 * 24 * 60 * 60 * 1000; // 7 Days Persistent Cache

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('fullDpModal')) {
        const modalHtml = `
        <div id="fullDpModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15, 23, 42, 0.85); z-index:10000; align-items:center; justify-content:center; backdrop-filter:blur(8px); opacity:0; transition: opacity 0.3s ease;">
            <span onclick="closeFullDp()" style="position:absolute; top:25px; right:30px; color:white; font-size:2.5rem; cursor:pointer; z-index:10001; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">&times;</span>
            <img id="fullDpImage" src="" style="width: 250px; height: 250px; border-radius: 50%; border: 4px solid #10b981; box-shadow: 0 20px 40px rgba(0,0,0,0.4); object-fit: cover; transform: scale(0.8); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
    if (window.loadWhatsAppDPs) window.loadWhatsAppDPs();
});

window.openFullDp = function(src) {
    if (src && !src.includes('data:image/svg')) {
        document.getElementById('fullDpImage').src = src;
        const modal = document.getElementById('fullDpModal');
        modal.style.display = 'flex';
        setTimeout(() => {
            modal.style.opacity = '1';
            document.getElementById('fullDpImage').style.transform = 'scale(1)';
        }, 10);
    }
};

window.closeFullDp = function() {
    const modal = document.getElementById('fullDpModal');
    modal.style.opacity = '0';
    document.getElementById('fullDpImage').style.transform = 'scale(0.8)';
    setTimeout(() => { modal.style.display = 'none'; }, 300);
};

async function fetchNewDP(number, img) {
    try {
        const response = await fetch(`/api/get-wa-dp/${number}`);
        const data = await response.json();
        
        if (data.success && data.url) {
            localStorage.setItem(CACHE_PREFIX + number, JSON.stringify({ url: data.url, ts: Date.now() }));
            img.src = data.url;
            img.style.cursor = 'pointer';
            img.onclick = () => window.openFullDp(img.src);
        } else {
            localStorage.setItem(CACHE_PREFIX + number, JSON.stringify({ url: 'none', ts: Date.now() }));
            img.src = WA_DEFAULT_DP;
            img.style.cursor = 'default';
            img.onclick = null;
        }
    } catch (e) {
        img.src = WA_DEFAULT_DP;
    }
}

const dpObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            const number = img.getAttribute('data-number');
            if (!number) return observer.unobserve(img);

            fetchNewDP(number, img);
            observer.unobserve(img);
        }
    });
}, { rootMargin: '250px 0px' }); 

window.loadWhatsAppDPs = async function() {
    const dpElements = document.querySelectorAll('.whatsapp-dp:not(.loaded)');
    
    dpElements.forEach(img => {
        img.classList.add('loaded');
        const number = img.getAttribute('data-number');
        let isCachedLocally = false;

        if (number) {
            const cachedStr = localStorage.getItem(CACHE_PREFIX + number);
            if (cachedStr) {
                try {
                    const cached = JSON.parse(cachedStr);
                    if (Date.now() - cached.ts < CACHE_TIME) {
                        isCachedLocally = true;
                        
                        if (cached.url === 'none') {
                            img.src = WA_DEFAULT_DP;
                            img.style.cursor = 'default';
                            img.onclick = null;
                        } else {
                            img.onerror = () => {
                                img.onerror = null; 
                                fetchNewDP(number, img); 
                            };
                            img.src = cached.url; 
                            img.style.cursor = 'pointer';
                            img.onclick = () => window.openFullDp(img.src);
                        }
                    }
                } catch(e) {}
            }
        }

        if (!isCachedLocally) {
            if(!img.src || img.src === window.location.href || img.src === '') {
                img.src = WA_DEFAULT_DP; 
            }
            dpObserver.observe(img);
        }
    });
};

const domObserver = new MutationObserver((mutations) => {
    let shouldRun = false;
    mutations.forEach(mutation => {
        if (mutation.addedNodes.length > 0) {
            for(let i=0; i<mutation.addedNodes.length; i++) {
                let node = mutation.addedNodes[i];
                if (node.nodeType === 1 && (node.classList.contains('whatsapp-dp') || node.querySelector('.whatsapp-dp'))) {
                    shouldRun = true;
                    break;
                }
            }
        }
    });
    if(shouldRun) {
        window.loadWhatsAppDPs();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const mainApp = document.getElementById('app-main') || document.body;
    domObserver.observe(mainApp, { childList: true, subtree: true });
});