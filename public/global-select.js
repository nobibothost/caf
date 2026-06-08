// public/global-select.js
// =====================================================================
// ULTRA SIMPLE & BULLETPROOF CUSTOM SELECT
// =====================================================================

(function() {
    let isPageScrolling = false;
    let startX = 0, startY = 0;

    // 1. Detect if the user is swiping/scrolling the main page
    document.addEventListener('touchstart', (e) => {
        isPageScrolling = false;
        if (e.touches && e.touches.length > 0) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!e.touches || !e.touches[0]) return;
        const moveX = Math.abs(e.touches[0].clientX - startX);
        const moveY = Math.abs(e.touches[0].clientY - startY);
        // If dragged more than 8 pixels, mark as scrolling
        if (moveX > 8 || moveY > 8) {
            isPageScrolling = true;
        }
    }, { passive: true });

    // 2. Setup reusable dialog structure
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

    // 3. Render and Open the Custom Dropdown
    function openCustomSelect(select) {
        setupModal();
        const b = document.getElementById('ssBackdrop');
        const d = document.getElementById('ssDialog');
        
        // Avoid double opening if already open
        if (b.classList.contains('open')) return;
        
        d.innerHTML = '';
        
        // Extract Label
        const title = document.createElement('div');
        title.className = 'ss-title';
        const label = select.closest('.input-group')?.querySelector('label');
        title.innerText = label ? label.innerText.replace('*', '').trim() : 'Select Option';
        d.appendChild(title);

        // Populate Options
        Array.from(select.options).forEach(opt => {
            if (opt.disabled && opt.value === "") return;

            const optDiv = document.createElement('div');
            optDiv.className = 'ss-option';
            optDiv.innerHTML = `<i class="ri-record-circle-line"></i> ${opt.text}`;
            
            if (!opt.disabled) {
                optDiv.onclick = (e) => {
                    e.stopPropagation();
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

        b.classList.add('open');
        d.classList.add('open');
    }

    // 4. DESKTOP FIX: Stop native dropdown menu from opening
    document.addEventListener('mousedown', (e) => {
        const select = e.target.closest('select');
        if (select) e.preventDefault(); 
    });

    // 5. DESKTOP / FALLBACK TRIGGER
    document.addEventListener('click', (e) => {
        const select = e.target.closest('select');
        if (select) {
            e.preventDefault();
            openCustomSelect(select);
        }
    });

    // 6. MOBILE FIX: Stop double dropdown & handle tap smoothly
    document.addEventListener('touchend', (e) => {
        const select = e.target.closest('select');
        if (select) {
            // If user swiped to scroll the page, do not open the dropdown
            if (isPageScrolling) return; 
            
            // Block the native mobile selector menu completely
            e.preventDefault(); 
            openCustomSelect(select);
        }
    }, { passive: false });

})();
