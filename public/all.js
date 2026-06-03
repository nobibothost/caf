// public/all.js
// =====================================================================
// ALL PAGE (NOTES) - LOGIC ONLY (No CSS Injection - Bug Free)
// =====================================================================

(function() {
    // Get customers data safely
    const getCustomers = () => window.allPageCustomersData || [];

    // Global Functions for Search and Filter
    window.filterCustomerList = function() {
        const searchInput = document.getElementById('customerSearchInput');
        const resultsDiv = document.getElementById('searchResults');
        
        if (!searchInput || !resultsDiv) return;

        const query = searchInput.value.toLowerCase().trim();
        resultsDiv.innerHTML = '';
        
        if (query.length < 1) { 
            resultsDiv.classList.remove('show'); 
            return; 
        }
        
        const customers = getCustomers();
        const filtered = customers.filter(c => c.name.toLowerCase().includes(query) || c.mobile.includes(query)).slice(0, 10);
        
        if (filtered.length > 0) {
            filtered.forEach(c => {
                const div = document.createElement('div');
                div.className = 'result-item';
                div.innerHTML = `<span class="name">${c.name}</span><span class="sub">${c.mobile}</span>`;
                div.onclick = () => selectCustomer(c._id, c.name, c.mobile);
                resultsDiv.appendChild(div);
            });
        } else {
            resultsDiv.innerHTML = '<div style="padding:10px; color:var(--text-muted); font-size:0.8rem;">No matching customer found</div>';
        }
        resultsDiv.classList.add('show');
    };

    window.selectCustomer = function(id, name, mobile) {
        const hiddenInput = document.getElementById('selectedCustomerId');
        const nameDisplay = document.getElementById('selectedCustomerName');
        const displayPill = document.getElementById('selectedCustomerDisplay');
        const searchInput = document.getElementById('customerSearchInput');
        const searchIcon = document.getElementById('searchIconDisplay');
        const resultsDiv = document.getElementById('searchResults');
        const manualInput = document.getElementById('manualMobileInput');

        if(hiddenInput) hiddenInput.value = id;
        if(nameDisplay) nameDisplay.innerText = `${name} (${mobile})`;
        if(displayPill) displayPill.style.display = 'flex';
        
        if(searchInput) {
            searchInput.value = '';
            searchInput.style.display = 'none';
        }
        
        if(resultsDiv) resultsDiv.classList.remove('show');
        if(searchIcon) searchIcon.style.display = 'none';
        
        if (manualInput) {
            manualInput.disabled = true;
            manualInput.style.opacity = '0.5';
            manualInput.value = '';
        }
    };

    window.clearSelectedCustomer = function() {
        const hiddenInput = document.getElementById('selectedCustomerId');
        const displayPill = document.getElementById('selectedCustomerDisplay');
        const searchInput = document.getElementById('customerSearchInput');
        const searchIcon = document.getElementById('searchIconDisplay');
        const manualInput = document.getElementById('manualMobileInput');

        if(hiddenInput) hiddenInput.value = '';
        if(displayPill) displayPill.style.display = 'none';
        
        if(searchInput) {
            searchInput.style.display = 'block';
            searchInput.focus();
        }
        if(searchIcon) searchIcon.style.display = 'block';
        
        if (manualInput) {
            manualInput.disabled = false;
            manualInput.style.opacity = '1';
        }
    };

    window.checkManualInput = function() {
        const manualInput = document.getElementById('manualMobileInput');
        const searchInput = document.getElementById('customerSearchInput');
        const resultsDiv = document.getElementById('searchResults');
        
        if (!manualInput || !searchInput) return;

        if (manualInput.value.length > 0) {
            searchInput.disabled = true;
            searchInput.style.opacity = '0.5';
            if (resultsDiv) resultsDiv.classList.remove('show');
        } else {
            searchInput.disabled = false;
            searchInput.style.opacity = '1';
        }
    };

    // Safely attach outside click listener only once
    if (!window.allJsListenerAdded) {
        document.addEventListener('click', (e) => {
            const container = document.querySelector('.custom-search-container');
            const resultsDiv = document.getElementById('searchResults');
            if (container && resultsDiv && !container.contains(e.target)) {
                resultsDiv.classList.remove('show');
            }
        });
        window.allJsListenerAdded = true;
    }

})();