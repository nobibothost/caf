// public/global-select.js
// =====================================================================
// REWRITTEN FROM SCRATCH: THE "NO-WRAPPER" SIMPLE METHOD (Logic Only)
// =====================================================================

(function() {
    // Setup the single shared modal dynamically
    function setupModal() {
        if (document.getElementById('ssBackdrop')) return;
        
        const b = document.createElement('div');
        b.className = 'ss-backdrop';
        b.id = 'ssBackdrop';
        
        const d = document.createElement('div');
        d.className = 'ss-dialog';
        d.id = 'ssDialog';
        
        b.addEventListener('click', () => {
            b.classList.remove('open');
            d.classList.remove('open');
        });
        
        document.body.appendChild(b);
        document.body.appendChild(d);
    }

    // Smart Click Interceptor (Catches any select click natively)
    function handleSelectClick(e) {
        const select = e.target.closest('select');
        if (select) {
            e.preventDefault(); // Stop native mobile dropdown from opening
            
            setupModal(); 
            const b = document.getElementById('ssBackdrop');
            const d = document.getElementById('ssDialog');
            
            d.innerHTML = ''; 
            
            // Extract Label for Title
            const title = document.createElement('div');
            title.className = 'ss-title';
            const label = select.closest('.input-group')?.querySelector('label');
            title.innerText = label ? label.innerText.replace('*', '').trim() : 'Select Option';
            d.appendChild(title);

            // Populate Custom Options
            Array.from(select.options).forEach(opt => {
                if (opt.disabled && opt.value === "") return;

                const optDiv = document.createElement('div');
                optDiv.className = 'ss-option';
                optDiv.innerHTML = `<i class="ri-record-circle-line"></i> ${opt.text}`;
                
                if (!opt.disabled) {
                    optDiv.onclick = () => {
                        // Directly update native select and trigger logic
                        select.value = opt.value;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        
                        b.classList.remove('open');
                        d.classList.remove('open');
                    };
                } else {
                    optDiv.style.opacity = '0.5';
                }
                d.appendChild(optDiv);
            });

            // Show Dialog
            b.classList.add('open');
            d.classList.add('open');
        }
    }

    // Bind interceptors to document (Works perfectly in SPAs without observer loops)
    document.addEventListener('mousedown', handleSelectClick);
    document.addEventListener('touchstart', handleSelectClick, { passive: false });

})();